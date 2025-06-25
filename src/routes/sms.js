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

async function tryAutoPair(from_phone) {
  const now = new Date().toISOString();
  const { data: slots } = await supabase.from('room_device_slots').select('*');

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

    const now = new Date().toISOString();
    let isAuthorized = false;
    let isStaff = false;

    // 2) STAFF CHECK (only authorized_numbers)
    try {
      const { data: authNum, error: authErr } = await supabase
        .from('authorized_numbers')
        .select('is_staff')
        .eq('phone', from_phone)
        .single();
      if (!authErr && authNum?.is_staff) {
        isAuthorized = true;
        isStaff = true;
      }
    } catch (err) {
      console.warn('⚠️ Staff lookup failed:', err.message);
    }

    // 3) GUEST AUTH if not staff
    if (!isAuthorized) {
      const { data: existing } = await supabase
        .from('authorized_numbers')
        .select('room_number,expires_at')
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

    // 4) BLOCK if unauthorized
    if (!isAuthorized) {
      console.log('🚫 Blocked SMS from unauthorized phone:', from_phone);
      await sendRejectionSms(
        from_phone,
        'Your request could not be received. Please contact the front desk to activate your guest access.'
      );
      return res.status(200).send('Ignored: unauthorized phone');
    }

    // 5) IDENTIFY HOTEL
    const { data: hotel, error: hotelErr } = await supabase
      .from('hotels')
      .select('id')
      .eq('phone_number', to)
      .single();
    if (hotelErr || !hotel) {
      return res.status(200).send('Ignored: unknown hotel number');
    }
    const hotel_id = hotel.id;

    // 6) CLASSIFY MESSAGE with hotel-specific departments
    let department = 'General';
    let priority = 'Normal';
    let room_number = null;

    try {
      const { data: deptRows, error: deptErr } = await supabase
        .from('departments')
        .select('name')
        .eq('hotel_id', hotel_id)
        .eq('enabled', true);

      if (deptErr) throw new Error(deptErr.message);

      const enabledDepartments = deptRows.map(d => d.name);
      const result = await classify(message, enabledDepartments);

      department = result.department;
      priority = result.priority;
      room_number = result.room_number;
    } catch (err) {
      console.warn('⚠️ Classification failed:', err.message || err);
    }

    // 7) GUEST TRACKING & VIP (ONLY if NOT staff)
    let isVip = false;
    if (!isStaff) {
      try {
        const { data: guest } = await supabase
          .from('guests')
          .select('total_requests')
          .eq('phone_number', from_phone)
          .single();

        if (guest) {
          const newTotal = guest.total_requests + 1;
          isVip = newTotal > 10;
          await supabase
            .from('guests')
            .update({
              total_requests: newTotal,
              last_seen: now,
              is_vip: isVip,
              is_staff: false, // force override
            })
            .eq('phone_number', from_phone);
        } else {
          await supabase
            .from('guests')
            .insert({
              phone_number: from_phone,
              total_requests: 1,
              last_seen: now,
              is_vip: false,
              is_staff: false,
            });
        }
      } catch (err) {
        console.warn('⚠️ Guest tracking failed:', err.message);
      }
    }

    // 8) INSERT REQUEST (with staff & VIP flags)
    const inserted = await insertRequest({
      hotel_id,
      from_phone,
      message,
      department,
      priority,
      room_number,
      is_staff: isStaff,
      is_vip: isVip,
      telnyx_id: telnyxId,
    });
    console.log('🆕 Request inserted:', inserted);
  } catch (err) {
    console.error('❌ Error in POST /sms:', err);
  }

  return res.status(200).json({ success: true });
});

router.patch('/:id/acknowledge', async (req, res, next) => {
  try {
    const id = req.params.id.trim();
    const updated = await acknowledgeRequestById(id);
    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: 'Request not found' });
    }
    await sendConfirmationSms(updated.from_phone);
    return res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/complete', async (req, res, next) => {
  try {
    const id = req.params.id.trim();
    const updated = await completeRequestById(id);
    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: 'Request not found' });
    }
    return res.status(200).json({ success: true, message: 'Request completed' });
  } catch (err) {
    next(err);
  }
});

export default router;
