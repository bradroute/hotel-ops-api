// src/routes/sms.js
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
 * Attempt to auto-pair a new phone number to any room based solely on NFC authorization:
 * - Has at least one active authorized number (expires_at > now OR expires_at IS NULL)
 * - Fewer than the maximum devices currently paired to that room
 */
async function tryAutoPair(from_phone) {
  const now = new Date().toISOString();

  const { data: slots } = await supabase
    .from('room_device_slots')
    .select('*');

  for (const slot of slots) {
    const { data: activeGuests } = await supabase
      .from('authorized_numbers')
      .select('expires_at')
      .eq('room_number', slot.room_number)
      .or('expires_at.gt.' + now + ',expires_at.is.null');

    if (activeGuests.length > 0 && slot.current_count < slot.max_devices) {
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

    // 2) Authorization check with staff override
    const now = new Date().toISOString();
    let isAuthorized = false;

    // Staff override: check guests table
    try {
      const { data: guest, error: guestErr } = await supabase
        .from('guests')
        .select('is_staff')
        .eq('phone_number', from_phone)
        .single();
      if (!guestErr && guest?.is_staff) {
        isAuthorized = true;
      }
    } catch (err) {
      console.warn('⚠️ Staff lookup failed:', err.message);
    }

    // Authorized numbers / auto-pair fallback
    if (!isAuthorized) {
      const { data: existing } = await supabase
        .from('authorized_numbers')
        .select('room_number, expires_at')
        .eq('phone', from_phone)
        .single();

      if (
        existing &&
        (existing.expires_at === null || existing.expires_at > now)
      ) {
        isAuthorized = true;
      } else {
        isAuthorized = await tryAutoPair(from_phone);
      }
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

    // Note: confirmation SMS is only sent on acknowledge

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
    if (!updated)
      return res
        .status(404)
        .json({ success: false, message: 'Request not found' });

    // Send confirmation back to guest
    try {
      const smsResult = await sendConfirmationSms(updated.from_phone);
      console.log('📨 Confirmation SMS sent:', smsResult);
    } catch (err) {
      console.error(`❌ Failure sending confirmation for request ${id}:`, err);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/complete', async (req, res, next) => {
  try {
    const id = req.params.id.trim();
    const updated = await completeRequestById(id);
    if (!updated)
      return res
        .status(404)
        .json({ success: false, message: 'Request not found' });
    return res.status(200).json({ success: true, message: 'Request completed' });
  } catch (err) {
    next(err);
  }
});

export default router;
