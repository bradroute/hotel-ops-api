import express from 'express';
import { supabase, supabaseAdmin, insertRequest } from '../services/supabaseService.js';
import { sendRejectionSms, sendConfirmationSms } from '../services/telnyxService.js';
import { classify } from '../services/classifier.js';
import { findByTelnyxId } from '../services/requestLookup.js';
import { acknowledgeRequestById, completeRequestById } from '../services/requestActions.js';
import { notifyStaffOnNewRequest } from '../services/notificationService.js';

const router = express.Router();

/* ───────────────────────── env toggles ───────────────────────── */
const REQUIRE_SMS_AUTH = process.env.SMS_REQUIRE_AUTH !== 'false'; // set SMS_REQUIRE_AUTH=false to bypass while testing

/* ───────────────────────── helpers ───────────────────────── */
const OUR_DIDS = new Set([
  '+16515717007', // Crosby SMS DID
  // add others here
]);
const isOurDid = (n) => !!n && OUR_DIDS.has(n);
const e164 = (n) => (n ? String(n).replace(/[^\d+]/g, '') : n);
const clip = (s, n = 160) => (typeof s === 'string' ? (s.length > n ? s.slice(0, n) + '…' : s) : '');

/* ───────────────────────── ingress log ───────────────────────── */
router.use((req, _res, next) => {
  try {
    const evt = req.body?.data?.event_type;
    const dir = req.body?.data?.payload?.direction;
    const from = req.body?.data?.payload?.from?.phone_number;
    const to = req.body?.data?.payload?.to?.[0]?.phone_number;
    const id = req.body?.data?.payload?.id;
    const text = req.body?.data?.payload?.text ?? '';
    if (evt && from && to) {
      console.log(`📨 /sms evt=${evt} dir=${dir} id=${id} from=${from} -> to=${to} | "${clip(text)}"`);
    } else {
      console.log('📨 /sms (unparsable payload shape)');
    }
  } catch {}
  next();
});

/* ───────────────────────── auto-pair logic ───────────────────────── */
async function tryAutoPair({ hotel_id, guest_phone }) {
  console.log('🔄 tryAutoPair start', { hotel_id, guest_phone });
  const now = new Date().toISOString();

  const { data: slots, error: slotsErr } = await supabase
    .from('room_device_slots')
    .select('*')
    .eq('hotel_id', hotel_id);
  if (slotsErr) console.error('❌ tryAutoPair slotsErr:', slotsErr);

  for (const slot of slots || []) {
    console.log('  ➡️ slot room', slot.room_number, 'count', slot.current_count, '/', slot.max_devices);
    const { data: activeGuests, error: guestErr } = await supabase
      .from('authorized_numbers')
      .select('expires_at')
      .eq('hotel_id', hotel_id)
      .eq('room_number', slot.room_number)
      .or(`expires_at.gt.${now},expires_at.is.null`);
    if (guestErr) console.error('❌ tryAutoPair guestErr:', guestErr);

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
      if (authErr) console.error('❌ tryAutoPair auth insert error:', authErr);

      const { error: updateErr } = await supabaseAdmin
        .from('room_device_slots')
        .update({ current_count: slot.current_count + 1 })
        .eq('hotel_id', hotel_id)
        .eq('room_number', slot.room_number);
      if (updateErr) console.error('❌ tryAutoPair slot update error:', updateErr);

      return { room_number: slot.room_number };
    }
  }

  console.log('  ❌ tryAutoPair: no available slot for', guest_phone);
  return null;
}

/* ───────────────────────── main webhook ───────────────────────── */
router.post('/', async (req, res) => {
  const t0 = Date.now();
  try {
    const eventType = req.body?.data?.event_type;
    const recordType = req.body?.data?.record_type;
    const msg = req.body?.data?.payload;

    // Gate: only real inbound MO messages
    if (recordType !== 'event' || !msg || msg.record_type !== 'message') {
      console.log('⏭️ sms: ignoring non-message record');
      return res.sendStatus(200);
    }
    if (eventType !== 'message.received' || msg.direction !== 'inbound') {
      console.log('⏭️ sms: ignoring non-inbound event', { eventType, direction: msg.direction });
      return res.sendStatus(200);
    }

    const telnyxId = msg.id;
    const from = e164(msg?.from?.phone_number);
    const to = e164(msg?.to?.[0]?.phone_number);
    const text = msg?.text ?? '';

    // Drop if from is our own DID (echo/loop protection)
    if (isOurDid(from)) {
      console.log('⏭️ sms: ignoring echo from our DID', from);
      return res.status(200).send('ignored: our DID');
    }

    // Idempotency: fast path
    if (await findByTelnyxId(telnyxId)) {
      console.log('⏭️ sms: duplicate telnyx_id', telnyxId);
      return res.status(200).send('ignored: duplicate');
    }

    // ── Resolve hotel by DID ─────────────────────────────────────
    console.log('🏨 sms: resolving hotel by DID →', to);

    let hotelId = null;

    // 1) Preferred: telnyx_numbers mapping table
    try {
      const { data: tn, error: tnErr } = await supabase
        .from('telnyx_numbers')
        .select('hotel_id')
        .eq('phone_number', to)
        .maybeSingle();
      if (tnErr) console.warn('⚠️ sms: telnyx_numbers lookup error:', tnErr?.message);
      hotelId = tn?.hotel_id || null;
      if (hotelId) console.log('   ✓ matched via telnyx_numbers');
    } catch (e) {
      console.warn('⚠️ sms: telnyx_numbers lookup failed:', e?.message);
    }

    // 2) Fallback: hotels.phone_number or hotels.front_desk_phone
    if (!hotelId) {
      const { data: h2, error: h2Err } = await supabase
        .from('hotels')
        .select('id')
        .or(`phone_number.eq.${to},front_desk_phone.eq.${to}`)
        .maybeSingle();
      if (h2Err) console.warn('⚠️ sms: hotels fallback lookup error:', h2Err?.message);
      hotelId = h2?.id || null;
      if (hotelId) console.log('   ✓ matched via hotels.{phone_number|front_desk_phone}');
    }

    if (!hotelId) {
      console.warn('🚫 sms: unknown DID; no mapping found to=', to);
      return res.status(200).send('ignored: unknown DID');
    }

    // Fetch hotel row (use fields that actually exist)
    const { data: hotel, error: hErr } = await supabase
      .from('hotels')
      .select('id, name, is_active')
      .eq('id', hotelId)
      .maybeSingle();
    if (hErr) {
      console.error('❌ sms: hotel fetch error:', hErr);
      return res.status(200).send('ignored: hotel fetch error');
    }
    if (!hotel || hotel.is_active === false) {
      console.warn('🚫 sms: hotel inactive/not found id=', hotelId);
      return res.status(200).send('ignored: hotel inactive');
    }
    console.log('✅ sms: hotel', hotel.id, hotel.name || '');

    // ── Staff / auth checks ──────────────────────────────────────
    let isStaff = false;
    try {
      const { data: staffRow, error: staffErr } = await supabase
        .from('authorized_numbers')
        .select('is_staff')
        .eq('hotel_id', hotel.id)
        .eq('phone', from)
        .maybeSingle();
      if (staffErr) console.warn('⚠️ sms: staff lookup error:', staffErr?.message);
      isStaff = !!staffRow?.is_staff;
      console.log('👥 sms: isStaff?', isStaff);
    } catch (e) {
      console.warn('⚠️ sms: staff check failed:', e?.message);
    }

    let isAuthorized = isStaff;
    let pairedRoom = null;
    const now = new Date().toISOString();

    if (!isAuthorized) {
      console.log('🔐 sms: checking guest authorization for', from);
      const { data: existing, error: authErr } = await supabase
        .from('authorized_numbers')
        .select('room_number, expires_at')
        .eq('hotel_id', hotel.id)
        .eq('phone', from)
        .maybeSingle();
      if (authErr) console.warn('⚠️ sms: auth lookup error:', authErr?.message);

      if (existing && (existing.expires_at === null || existing.expires_at > now)) {
        isAuthorized = true;
        pairedRoom = existing.room_number;
        console.log('✅ sms: authorized via existing record; room', pairedRoom || '(none)');
      } else {
        console.log('🔎 sms: trying auto-pair…');
        const pairing = await tryAutoPair({ hotel_id: hotel.id, guest_phone: from });
        if (pairing) {
          isAuthorized = true;
          pairedRoom = pairing.room_number;
          console.log('✅ sms: auto-paired to room', pairedRoom);
        }
      }
    }

    if (!isAuthorized && REQUIRE_SMS_AUTH) {
      console.warn('🚫 sms: blocked unauthorized number; auth required (set SMS_REQUIRE_AUTH=false to bypass)');
      try {
        await sendRejectionSms(
          from,
          'Your request could not be received. Please contact the front desk to activate your guest access.'
        );
      } catch (e) {
        console.error('❌ sms: rejection send failed:', e?.payload || e?.message || e);
      }
      return res.status(200).send('blocked: unauthorized');
    } else if (!isAuthorized) {
      console.log('⚠️ sms: bypassing auth for testing (SMS_REQUIRE_AUTH=false)');
    }

    // ── Confirmation (best-effort) ───────────────────────────────
    try {
      await sendConfirmationSms(
        from,
        `Operon: Thanks for contacting ${hotel.name || 'the hotel'}. We will be with you shortly. Msg freq may vary. Std msg & data rates apply. We will not sell or share your mobile information for promotional or marketing purposes.`
      );
      console.log('📤 sms: confirmation sent to', from);
    } catch (e) {
      console.error('❌ sms: confirmation send failed:', e?.payload || e?.message || e);
    }

    // ── Classification (best-effort) ─────────────────────────────
    let classification = { department: 'Front Desk', priority: 'normal', room_number: pairedRoom };
    try {
      const c = await classify(text, hotel.id);
      if (c) classification = { ...classification, ...c };
      console.log('🧠 sms: classify →', classification);
    } catch (e) {
      console.warn('⚠️ sms: classification failed:', e?.message);
    }

    // ── Guest tracking (non-staff) ───────────────────────────────
    if (!isStaff) {
      try {
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
          console.log('🗂️ sms: guest updated (total_requests=', newTotal, ')');
        } else {
          await supabase
            .from('guests')
            .insert({ hotel_id: hotel.id, phone_number: from, total_requests: 1, last_seen: now, is_vip: false });
          console.log('🗂️ sms: guest created');
        }
      } catch (e) {
        console.warn('⚠️ sms: guest tracking failed (non-fatal):', e?.message);
      }
    }

    // ── Insert request ───────────────────────────────────────────
    let created = null;
    try {
      created = await insertRequest({
        hotel_id: hotel.id,
        from_phone: from,
        message: text,
        department: classification.department,
        priority: classification.priority,
        room_number: classification.room_number || pairedRoom || '',
        is_staff: isStaff,
        is_vip: false,
        telnyx_id: telnyxId,
        source: 'sms',
      });
      console.log('✅ sms: request inserted id=', created?.id, 'source=', created?.source);
    } catch (e) {
      console.error('🔥 sms: insertRequest failed:', e?.message || e);
      return res.status(200).send('insert failed'); // keep 200 to prevent Telnyx retries
    }

    // Async staff notify
    notifyStaffOnNewRequest(created).catch((e) => console.error('⚠️ staff notify (sms) failed', e));

    console.log('🏁 /sms done in', Date.now() - t0, 'ms');
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('❌ Error in POST /sms:', err);
    console.log('🏁 /sms errored in', Date.now() - t0, 'ms');
    return res.status(200).json({ success: true }); // always 200 to stop Telnyx retries
  }
});

/* ───────────────────────── ack / complete ───────────────────────── */
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
