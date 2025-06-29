// src/routes/sms.js
import express from 'express';
import { supabase, supabaseAdmin, insertRequest } from '../services/supabaseService.js';
import { sendRejectionSms, sendConfirmationSms } from '../services/telnyxService.js';
import { classify } from '../services/classifier.js';
import { findByTelnyxId } from '../services/requestLookup.js';
import {
  acknowledgeRequestById,
  completeRequestById,
} from '../services/requestActions.js';

const router = express.Router();

// Log middleware for all incoming SMS webhooks
router.use((req, res, next) => {
  console.log('🔍 /sms payload:', JSON.stringify(req.body).slice(0,500));
  next();
});

async function tryAutoPair(from_phone) {
  console.log('🔄 tryAutoPair called for', from_phone);
  const now = new Date().toISOString();
  const { data: slots, error: slotsErr } = await supabase
    .from('room_device_slots')
    .select('*');
  if (slotsErr) console.error('❌ error fetching slots:', slotsErr);
  console.log('📦 current slots:', slots);

  for (const slot of slots) {
    console.log('  ➡️  checking slot for room', slot.room_number, slot);
    const { data: activeGuests, error: guestErr } = await supabase
      .from('authorized_numbers')
      .select('expires_at')
      .eq('room_number', slot.room_number)
      .or('expires_at.gt.' + now + ',expires_at.is.null');
    if (guestErr) console.error('❌ error fetching activeGuests:', guestErr);
    console.log('    👫 activeGuests:', activeGuests);

    if (activeGuests.length > 0 && slot.current_count < slot.max_devices) {
      console.log('    ✅ slot available, pairing', from_phone, 'to room', slot.room_number);
      const expires_at = activeGuests[0].expires_at;

      // Insert using admin client and include hotel_id
      const { data: insertedAuth, error: authErr } = await supabaseAdmin
        .from('authorized_numbers')
        .insert({
          phone: from_phone,
          room_number: slot.room_number,
          expires_at,
          hotel_id: slot.hotel_id,
          is_staff: false,
        })
        .select();
      if (authErr) console.error('❌ Error inserting authorized_numbers:', authErr);
      else console.log('    ➕ inserted authorized_numbers for', from_phone, insertedAuth);

      // Bump slot count using admin client
      const { data: updatedSlot, error: updateErr } = await supabaseAdmin
        .from('room_device_slots')
        .update({ current_count: slot.current_count + 1 })
        .eq('room_number', slot.room_number)
        .select()
        .single();
      if (updateErr) console.error('❌ Error updating slot count:', updateErr);
      else console.log('    ↗️  incremented slot count for room', slot.room_number, updatedSlot);

      return true;
    }
  }

  console.log('    ❌ no slot found or slots full for', from_phone);
  return false;
}

router.post('/', async (req, res) => {
  console.log('🚀 POST /sms hit');
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

    // Ignore outgoing SMS from our own hotel number
    const { data: possibleHotel } = await supabase
      .from('hotels')
      .select('id')
      .eq('phone_number', from_phone)
      .maybeSingle();
    if (possibleHotel) return res.status(200).send('Ignored: outgoing SMS from hotel');

    // 2) Duplicate guard
    if (await findByTelnyxId(telnyxId)) {
      return res.status(200).send('Ignored: duplicate SMS');
    }

    const now = new Date().toISOString();
    let isAuthorized = false;
    let isStaff = false;

    // 3) STAFF CHECK
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

    // 4) GUEST AUTH or AUTO-PAIR
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

    // 5) BLOCK if still unauthorized
    if (!isAuthorized) {
      console.log('🚫 Blocked SMS from unauthorized phone:', from_phone);
      await sendRejectionSms(
        from_phone,
        'Your request could not be received. Please contact the front desk to activate your guest access.'
      );
      return res.status(200).send('Ignored: unauthorized phone');
    }

    // 6) HOTEL LOOKUP
    const { data: hotel, error: hotelErr } = await supabase
      .from('hotels')
      .select('id')
      .eq('phone_number', to)
      .single();
    if (hotelErr || !hotel) return res.status(200).send('Ignored: unknown hotel number');
    const hotel_id = hotel.id;

    // 7) CLASSIFY MESSAGE
    console.log('📩 Incoming SMS for classification:', message);
    let classification = { department: 'Front Desk', priority: 'normal', room_number: null };
    try {
      classification = await classify(message, hotel_id);
      console.log('🧠 Classified via SMS route:', classification);
    } catch (err) {
      console.warn('⚠️ Classification failed:', err.message || err);
    }
    const { department, priority, room_number } = classification;

    // 8) GUEST TRACKING
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
              is_staff: false,
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

    // 9) INSERT REQUEST
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
      return res.status(404).json({ success: false, message: 'Request not found' });
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
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    return res.status(200).json({ success: true, message: 'Request completed' });
  } catch (err) {
    next(err);
  }
});

export default router;
