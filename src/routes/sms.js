// sms.js
import express from 'express';
import { supabase, insertRequest } from '../services/supabaseService.js';
import { sendRejectionSms, sendConfirmationSms } from '../services/telnyxService.js';
import { classify } from '../services/classifier.js';
import { findByTelnyxId } from '../services/requestLookup.js';
import {
  acknowledgeRequestById,
  completeRequestById,
} from '../services/requestActions.js';

const router = express.Router();

/**
 * Attempt to auto-pair a new phone number to any room that:
 * - Has at least one active guest (expires_at > now)
 * - Has fewer than 4 devices currently paired
 */
async function tryAutoPair(from_phone) {
  const now = new Date().toISOString();

  // Fetch all room slots
  const { data: slots } = await supabase
    .from('room_device_slots')
    .select('*');

  for (const slot of slots) {
    // Check if the room has at least one active guest
    const { data: activeGuests } = await supabase
      .from('authorized_numbers')
      .select('expires_at')
      .eq('room_number', slot.room_number)
      .gt('expires_at', now);

    if (activeGuests.length > 0 && slot.current_count < slot.max_devices) {
      // Pair this new phone to the room
      const expires_at = activeGuests[0].expires_at;
      await supabase.from('authorized_numbers').insert({
        phone: from_phone,
        room_number: slot.room_number,
        expires_at,
      });
      await supabase
        .from('room_device_slots')
        .update({ current_count: slot.current_count + 1 })
        .eq('room_number', slot.room_number);
      return true;
    }
  }

  return false;
}

router.post('/', async (req, res) => {
  try {
    const payload = req.body?.data?.payload || {};
    const from_phone = payload.from?.phone_number;
    const to = payload.to?.[0]?.phone_number;
    const message = payload.text;
    const telnyxId = payload.id;

    // 1) Basic validation
    if (!from_phone || !to || !message) {
      return res.status(200).send('Ignored: missing fields');
    }
    if (from_phone === process.env.TELNYX_NUMBER) {
      return res.status(200).send('Ignored: outgoing SMS');
    }
    if (await findByTelnyxId(telnyxId)) {
      return res.status(200).send('Ignored: duplicate SMS');
    }

    // 2) Authorization check
    const now = new Date().toISOString();
    const { data: existing } = await supabase
      .from('authorized_numbers')
      .select('room_number, expires_at')
      .eq('phone', from_phone)
      .single();

    let isAuthorized = false;
    if (existing && existing.expires_at > now) {
      isAuthorized = true;
    } else {
      // Try auto-pairing up to 4 phones per room
      isAuthorized = await tryAutoPair(from_phone);
    }

    if (!isAuthorized) {
      console.log('🚫 Blocked SMS from unauthorized phone:', from_phone);
      await sendRejectionSms(
        from_phone,
        'Your request could not be received. Please contact the front desk to activate your guest access.'
      );
      return res.status(200).send('Ignored: unauthorized phone');
    }

    // 3) Identify hotel by destination number
    const { data: hotel, error: hotelErr } = await supabase
      .from('hotels')
      .select('id')
      .eq('phone_number', to)
      .single();
    if (hotelErr || !hotel) {
      return res.status(200).send('Ignored: unknown hotel number');
    }
    const hotel_id = hotel.id;

    // 4) Classify message
    let department = 'General';
    let priority = 'Normal';
    let room_number = null;
    try {
      const result = await classify(message);
      department = result.department;
      priority = result.priority;
      room_number = result.room_number;
    } catch (err) {
      console.warn('⚠️ Classification failed, using defaults.', err);
    }

    // 5) Insert the request
    const inserted = await insertRequest({
      hotel_id,
      from_phone,
      message,
      department,
      priority,
      room_number,
      telnyx_id: telnyxId,
    });
    console.log('🆕 Request inserted:', inserted);

    // Optionally, send a confirmation SMS to the guest
    try {
      await sendConfirmationSms(from_phone);
    } catch (err) {
      console.error('❌ Confirmation SMS failed:', err);
    }

  } catch (err) {
    console.error('❌ Error in POST /sms:', err);
  }

  // Always acknowledge to Telnyx
  return res.status(200).json({ success: true });
});

router.patch('/:id/acknowledge', async (req, res, next) => {
  try {
    const id = req.params.id.trim();
    const updated = await acknowledgeRequestById(id);
    if (!updated) return res.status(404).json({ success: false, message: 'Request not found' });

    // Send confirmation back to guest
    const smsResult = await sendConfirmationSms(updated.from_phone);
    return res.status(200).json({ success: true, telnyx: smsResult });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/complete', async (req, res, next) => {
  try {
    const id = req.params.id.trim();
    const updated = await completeRequestById(id);
    if (!updated) return res.status(404).json({ success: false, message: 'Request not found' });
    return res.status(200).json({ success: true, message: 'Request completed' });
  } catch (err) {
    next(err);
  }
});

export default router;
