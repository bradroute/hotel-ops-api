import express from 'express';
import { supabase, supabaseAdmin, insertRequest } from '../services/supabaseService.js';
import { sendRejectionSms, sendConfirmationSms } from '../services/telnyxService.js';
import { classify } from '../services/classifier.js';
import { findByTelnyxId } from '../services/requestLookup.js';
import { acknowledgeRequestById, completeRequestById } from '../services/requestActions.js';
import { notifyStaffOnNewRequest } from '../services/notificationService.js';
import logger from '../lib/logger.js';

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
      logger.info({ evt, dir, id, from, to, text: clip(text) }, 'sms webhook received');
    } else {
      logger.info('sms webhook received (unparsable payload shape)');
    }
  } catch {}
  next();
});

/* ───────────────────────── auto-pair logic ───────────────────────── */
async function tryAutoPair({ hotel_id, guest_phone }) {
  logger.info({ hotel_id, guest_phone }, 'tryAutoPair start');
  const now = new Date().toISOString();

  const { data: slots, error: slotsErr } = await supabase
    .from('room_device_slots')
    .select('*')
    .eq('hotel_id', hotel_id);
  if (slotsErr) logger.error({ err: slotsErr }, 'tryAutoPair slotsErr');

  for (const slot of slots || []) {
    logger.debug({ room: slot.room_number, count: slot.current_count, max: slot.max_devices }, 'tryAutoPair checking slot');
    const { data: activeGuests, error: guestErr } = await supabase
      .from('authorized_numbers')
      .select('expires_at')
      .eq('hotel_id', hotel_id)
      .eq('room_number', slot.room_number)
      .or(`expires_at.gt.${now},expires_at.is.null`);
    if (guestErr) logger.error({ err: guestErr }, 'tryAutoPair guestErr');

    if ((activeGuests?.length || 0) > 0 && slot.current_count < slot.max_devices) {
      logger.info({ guest_phone, room: slot.room_number }, 'tryAutoPair pairing guest');
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
      if (authErr) logger.error({ err: authErr }, 'tryAutoPair auth insert error');

      const { error: updateErr } = await supabaseAdmin
        .from('room_device_slots')
        .update({ current_count: slot.current_count + 1 })
        .eq('hotel_id', hotel_id)
        .eq('room_number', slot.room_number);
      if (updateErr) logger.error({ err: updateErr }, 'tryAutoPair slot update error');

      return { room_number: slot.room_number };
    }
  }

  logger.info({ guest_phone }, 'tryAutoPair: no available slot');
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
      logger.debug('sms: ignoring non-message record');
      return res.sendStatus(200);
    }
    if (eventType !== 'message.received' || msg.direction !== 'inbound') {
      logger.debug({ eventType, direction: msg.direction }, 'sms: ignoring non-inbound event');
      return res.sendStatus(200);
    }

    const telnyxId = msg.id;
    const from = e164(msg?.from?.phone_number);
    const to = e164(msg?.to?.[0]?.phone_number);
    const text = msg?.text ?? '';

    // Drop if from is our own DID (echo/loop protection)
    if (isOurDid(from)) {
      logger.debug({ from }, 'sms: ignoring echo from our DID');
      return res.status(200).send('ignored: our DID');
    }

    // Idempotency: fast path
    if (await findByTelnyxId(telnyxId)) {
      logger.debug({ telnyxId }, 'sms: duplicate telnyx_id');
      return res.status(200).send('ignored: duplicate');
    }

    // ── Resolve hotel by DID ─────────────────────────────────────
    logger.info({ to }, 'sms: resolving hotel by DID');

    let hotelId = null;

    // 1) Preferred: telnyx_numbers mapping table
    try {
      const { data: tn, error: tnErr } = await supabase
        .from('telnyx_numbers')
        .select('hotel_id')
        .eq('phone_number', to)
        .maybeSingle();
      if (tnErr) logger.warn({ err: tnErr }, 'sms: telnyx_numbers lookup error');
      hotelId = tn?.hotel_id || null;
      if (hotelId) logger.info('sms: matched via telnyx_numbers');
    } catch (e) {
      logger.warn({ err: e }, 'sms: telnyx_numbers lookup failed');
    }

    // 2) Fallback: hotels.phone_number or hotels.front_desk_phone
    if (!hotelId) {
      const { data: h2, error: h2Err } = await supabase
        .from('hotels')
        .select('id')
        .or(`phone_number.eq.${to},front_desk_phone.eq.${to}`)
        .maybeSingle();
      if (h2Err) logger.warn({ err: h2Err }, 'sms: hotels fallback lookup error');
      hotelId = h2?.id || null;
      if (hotelId) logger.info('sms: matched via hotels.phone_number|front_desk_phone');
    }

    if (!hotelId) {
      logger.warn({ to }, 'sms: unknown DID; no mapping found');
      return res.status(200).send('ignored: unknown DID');
    }

    // Fetch hotel row (use fields that actually exist)
    const { data: hotel, error: hErr } = await supabase
      .from('hotels')
      .select('id, name, is_active')
      .eq('id', hotelId)
      .maybeSingle();
    if (hErr) {
      logger.error({ err: hErr }, 'sms: hotel fetch error');
      return res.status(200).send('ignored: hotel fetch error');
    }
    if (!hotel || hotel.is_active === false) {
      logger.warn({ hotelId }, 'sms: hotel inactive/not found');
      return res.status(200).send('ignored: hotel inactive');
    }
    logger.info({ hotelId: hotel.id, hotelName: hotel.name }, 'sms: hotel resolved');

    // ── Staff / auth checks ──────────────────────────────────────
    let isStaff = false;
    try {
      const { data: staffRow, error: staffErr } = await supabase
        .from('authorized_numbers')
        .select('is_staff')
        .eq('hotel_id', hotel.id)
        .eq('phone', from)
        .maybeSingle();
      if (staffErr) logger.warn({ err: staffErr }, 'sms: staff lookup error');
      isStaff = !!staffRow?.is_staff;
      logger.info({ isStaff }, 'sms: staff check result');
    } catch (e) {
      logger.warn({ err: e }, 'sms: staff check failed');
    }

    let isAuthorized = isStaff;
    let pairedRoom = null;
    const now = new Date().toISOString();

    if (!isAuthorized) {
      logger.info({ from }, 'sms: checking guest authorization');
      const { data: existing, error: authErr } = await supabase
        .from('authorized_numbers')
        .select('room_number, expires_at')
        .eq('hotel_id', hotel.id)
        .eq('phone', from)
        .maybeSingle();
      if (authErr) logger.warn({ err: authErr }, 'sms: auth lookup error');

      if (existing && (existing.expires_at === null || existing.expires_at > now)) {
        isAuthorized = true;
        pairedRoom = existing.room_number;
        logger.info({ room: pairedRoom }, 'sms: authorized via existing record');
      } else {
        logger.info('sms: trying auto-pair');
        const pairing = await tryAutoPair({ hotel_id: hotel.id, guest_phone: from });
        if (pairing) {
          isAuthorized = true;
          pairedRoom = pairing.room_number;
          logger.info({ room: pairedRoom }, 'sms: auto-paired');
        }
      }
    }

    if (!isAuthorized && REQUIRE_SMS_AUTH) {
      logger.warn('sms: blocked unauthorized number; auth required');
      try {
        await sendRejectionSms(
          from,
          'Your request could not be received. Please contact the front desk to activate your guest access.'
        );
      } catch (e) {
        logger.error({ err: e }, 'sms: rejection send failed');
      }
      return res.status(200).send('blocked: unauthorized');
    } else if (!isAuthorized) {
      logger.info('sms: bypassing auth for testing (SMS_REQUIRE_AUTH=false)');
    }

    // ── Confirmation (best-effort) ───────────────────────────────
    try {
      await sendConfirmationSms(
        from,
        `Operon: Thanks for contacting ${hotel.name || 'the hotel'}. We will be with you shortly. Msg freq may vary. Std msg & data rates apply. We will not sell or share your mobile information for promotional or marketing purposes.`
      );
      logger.info({ to: from }, 'sms: confirmation sent');
    } catch (e) {
      logger.error({ err: e }, 'sms: confirmation send failed');
    }

    // ── Classification (best-effort) ─────────────────────────────
    let classification = { department: 'Front Desk', priority: 'normal', room_number: pairedRoom };
    try {
      const c = await classify(text, hotel.id);
      if (c) classification = { ...classification, ...c };
      logger.info({ classification }, 'sms: classify result');
    } catch (e) {
      logger.warn({ err: e }, 'sms: classification failed');
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
          logger.info({ total_requests: newTotal }, 'sms: guest updated');
        } else {
          await supabase
            .from('guests')
            .insert({ hotel_id: hotel.id, phone_number: from, total_requests: 1, last_seen: now, is_vip: false });
          logger.info('sms: guest created');
        }
      } catch (e) {
        logger.warn({ err: e }, 'sms: guest tracking failed (non-fatal)');
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
      logger.info({ requestId: created?.id, source: created?.source }, 'sms: request inserted');
    } catch (e) {
      logger.error({ err: e }, 'sms: insertRequest failed');
      return res.status(200).send('insert failed'); // keep 200 to prevent Telnyx retries
    }

    // Async staff notify
    notifyStaffOnNewRequest(created).catch((e) => logger.error({ err: e }, 'staff notify (sms) failed'));

    logger.info({ durationMs: Date.now() - t0 }, 'sms: webhook complete');
    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ err, durationMs: Date.now() - t0 }, 'sms: webhook error');
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
