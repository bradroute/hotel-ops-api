// src/routes/sms.js
import express from 'express';
import { supabase, supabaseAdmin, insertRequest } from '../services/supabaseService.js';
import { sendRejectionSms, sendConfirmationSms } from '../services/telnyxService.js';
import { classify } from '../services/classifier.js';
import { findByTelnyxId } from '../services/requestLookup.js';
import { acknowledgeRequestById, completeRequestById } from '../services/requestActions.js';
import { notifyStaffOnNewRequest } from '../services/notificationService.js';

const router = express.Router();

/** --- helpers --- */
const OUR_DIDS = new Set([
  '+16515717007', // Crosby SMS DID
  // add others here
]);
const isOurDid = (n) => !!n && OUR_DIDS.has(n);
const e164 = (n) => (n ? String(n).replace(/[^\d+]/g, '') : n);

/** minimal log for triage */
router.use((req, _res, next) => {
  try {
    const evt = req.body?.data?.event_type;
    const dir = req.body?.data?.payload?.direction;
    const from = req.body?.data?.payload?.from?.phone_number;
    const to = req.body?.data?.payload?.to?.[0]?.phone_number;
    const id = req.body?.data?.payload?.id;
    if (evt && from && to) {
      console.log(`📨 /sms evt=${evt} dir=${dir} id=${id} from=${from} -> to=${to}`);
    } else {
      console.log('📨 /sms (unparsable)');
    }
  } catch {}
  next();
});

async function tryAutoPair({ hotel_id, guest_phone }) {
  console.log('🔄 tryAutoPair', guest_phone, 'hotel', hotel_id);
  const now = new Date().toISOString();

  const { data: slots, error: slotsErr } = await supabase
    .from('room_device_slots')
    .select('*')
    .eq('hotel_id', hotel_id);
  if (slotsErr) console.error('slotsErr', slotsErr);

  for (const slot of slots || []) {
    console.log('  ➡️ room', slot.room_number);
    const { data: activeGuests, error: guestErr } = await supabase
      .from('authorized_numbers')
      .select('expires_at')
      .eq('hotel_id', hotel_id)
      .eq('room_number', slot.room_number)
      .or(`expires_at.gt.${now},expires_at.is.null`);
    if (guestErr) console.error('guestErr', guestErr);

    if ((activeGuests?.length || 0) > 0 && slot.current_count < slot.max_devices) {
      console.log('  ✅ pairing', guest_phone, '→', slot.room_number);
      const expires_at = activeGuests[0].expires_at ?? null;

      const { error: authErr } = await supabaseAdmin
        .from('authorized_numbers')
        .insert({
          hotel_id,
          phone: guest_phone,
          room_number: slot.room_number,
          expires_at,
          is_staff: false,
        });
      if (authErr) console.error('authErr', authErr);

      const { error: updateErr } = await supabaseAdmin
        .from('room_device_slots')
        .update({ current_count: slot.current_count + 1 })
        .eq('hotel_id', hotel_id)
        .eq('room_number', slot.room_number);
      if (updateErr) console.error('slot updateErr', updateErr);

      return { room_number: slot.room_number };
    }
  }

  console.log('  ❌ no slot available for', guest_phone);
  return null;
}

router.post('/', async (req, res) => {
  try {
    const eventType = req.body?.data?.event_type;
    const recordType = req.body?.data?.record_type;
    const msg = req.body?.data?.payload;

    // Gate: only real inbound MO messages
    if (recordType !== 'event' || !msg || msg.record_type !== 'message') return res.sendStatus(200);
    if (eventType !== 'message.received' || msg.direction !== 'inbound') return res.sendStatus(200);

    const telnyxId = msg.id;
    const from = e164(msg?.from?.phone_number);
    const to = e164(msg?.to?.[0]?.phone_number);
    const text = msg?.text ?? '';

    // Drop if from is our own DID (echo/loop protection)
    if (isOurDid(from)) return res.status(200).send('ignored: our DID');

    // Idempotency: fast path
    if (await findByTelnyxId(telnyxId)) return res.status(200).send('ignored: duplicate');

    // Resolve hotel by DID (use SMS DID column if available; fall back to phone_number)
    let hotel = null;
    {
      const { data, error } = await supabase
        .from('hotels')
        .select('id, display_name')
        .or(`sms_did.eq.${to},phone_number.eq.${to}`)
        .maybeSingle();
      if (error || !data) return res.status(200).send('ignored: unknown DID');
      hotel = data;
    }

    const now = new Date().toISOString();

    // Staff check
    let isStaff = false;
    {
      const { data, error } = await supabase
        .from('authorized_numbers')
        .select('is_staff')
        .eq('hotel_id', hotel.id)
        .eq('phone', from)
        .maybeSingle();
      if (!error && data?.is_staff) isStaff = true;
    }

    // Authorization / pairing
    let isAuthorized = isStaff;
    let pairedRoom = null;

    if (!isAuthorized) {
      const { data: existing } = await supabase
        .from('authorized_numbers')
        .select('room_number, expires_at')
        .eq('hotel_id', hotel.id)
        .eq('phone', from)
        .maybeSingle();

      if (existing && (existing.expires_at === null || existing.expires_at > now)) {
        isAuthorized = true;
        pairedRoom = existing.room_number;
      } else {
        const pairing = await tryAutoPair({ hotel_id: hotel.id, guest_phone: from });
        if (pairing) {
          isAuthorized = true;
          pairedRoom = pairing.room_number;
        }
      }
    }

    if (!isAuthorized) {
      await sendRejectionSms(from,
        'Your request could not be received. Please contact the front desk to activate your guest access. Reply HELP for assistance or STOP to unsubscribe.'
      );
      return res.status(200).send('blocked: unauthorized');
    }

    // Confirmation (use separate /sms-status in telnyxService to avoid recursion)
    await sendConfirmationSms(
      from,
      `Operon: Thanks for contacting ${hotel.display_name || 'the hotel'}. We will be with you shortly. Msg freq may vary. Std msg & data rates apply. We will not sell or share your mobile information for promotional or marketing purposes. Reply HELP for assistance or STOP to unsubscribe.`
    );

    // Classification (best-effort)
    let classification = { department: 'Front Desk', priority: 'normal', room_number: pairedRoom };
    try {
      const c = await classify(text, hotel.id);
      if (c) classification = { ...classification, ...c };
    } catch (e) {
      console.warn('classification failed', e?.message);
    }

    // Guest tracking (only non-staff)
    if (!isStaff) {
      const { data: guest } = await supabase
        .from('guests')
        .select('total_requests')
        .eq('hotel_id', hotel.id)
        .eq('phone_number', from)
        .maybeSingle();
      if (guest) {
        const newTotal = (guest.total_requests || 0) + 1;
        await supabase
          .from('guests')
          .update({ total_requests: newTotal, last_seen: now, is_vip: newTotal > 10 })
          .eq('hotel_id', hotel.id)
          .eq('phone_number', from);
      } else {
        await supabase
          .from('guests')
          .insert({ hotel_id: hotel.id, phone_number: from, total_requests: 1, last_seen: now, is_vip: false });
      }
    }

    // Insert request
    const created = await insertRequest({
      hotel_id: hotel.id,
      from_phone: from,
      message: text,
      department: classification.department,
      priority: classification.priority,
      room_number: classification.room_number || pairedRoom,
      is_staff: isStaff,
      is_vip: false, // recompute in insert if you store it
      telnyx_id: telnyxId,
      source: 'sms',
    });

    // Async staff notify
    notifyStaffOnNewRequest(created).catch((e) => console.error('staff notify (sms) failed', e));

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('❌ Error in POST /sms:', err);
    return res.status(200).json({ success: true }); // always 200 to stop Telnyx retries
  }
});

/** acknowledge / complete unchanged **/
router.patch('/:id/acknowledge', async (req, res, next) => {
  try {
    const id = req.params.id.trim();
    const updated = await acknowledgeRequestById(id);
    if (!updated) return res.status(404).json({ success: false, message: 'Request not found' });
    return res.status(200).json({ success: true });
  } catch (err) { next(err); }
});

router.patch('/:id/complete', async (req, res, next) => {
  try {
    const id = req.params.id.trim();
    const updated = await completeRequestById(id);
    if (!updated) return res.status(404).json({ success: false, message: 'Request not found' });
    return res.status(200).json({ success: true, message: 'Request completed' });
  } catch (err) { next(err); }
});

export default router;
