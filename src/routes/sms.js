// src/routes/sms.js

import express from 'express';
const router = express.Router();

import {
  supabase,
  insertRequest,
  findByTelnyxId,
  acknowledgeRequestById,
  completeRequestById,
  getAllRequests,
} from '../services/supabaseService.js';

import { sendConfirmationSms } from '../services/telnyxService.js';
import { classify } from '../services/classifier.js';

// POST /sms — Handle incoming SMS from Telnyx
router.post('/', async (req, res) => {
  console.log('🔍 Incoming webhook body:', JSON.stringify(req.body, null, 2));
  console.log('✅ POST /sms route hit');

  try {
    const payload = req.body?.data?.payload || {};

    const from_phone = payload.from?.phone_number;
    const toArray = payload.to;
    const to = Array.isArray(toArray) && toArray[0]?.phone_number;
    const message = payload.text;
    const telnyxId = payload.id;

    if (!from_phone || !to || !message) {
      console.log('⚠️ Missing from_phone/to/text — skipping.');
      return res.status(200).send('Ignored: missing fields');
    }

    if (
      from_phone === process.env.TELNYX_NUMBER ||
      message === 'Hi! Your request has been received and is being taken care of. - Hotel Crosby'
    ) {
      console.log('📤 Outgoing/confirmation message — skipping.');
      return res.status(200).send('Ignored: outgoing confirmation');
    }

    if (await findByTelnyxId(telnyxId)) {
      console.log(`⚠️ Duplicate Telnyx ID ${telnyxId} — skipping.`);
      return res.status(200).send('Ignored: duplicate');
    }

    const { data: hotel, error: hotelErr } = await supabase
      .from('hotels')
      .select('id')
      .eq('phone_number', to)
      .single();

    if (hotelErr || !hotel) {
      console.warn(`⚠️ Unrecognized destination number: ${to}`);
      return res.status(200).send('Ignored: unknown hotel number');
    }
    const hotel_id = hotel.id;

    let department = 'General', priority = 'Normal';
    try {
      const c = await classify(message);
      department = c.department;
      priority = c.priority;
    } catch (err) {
      console.warn('⚠️ Classification failed, defaulting to General/Normal', err);
    }

    const inserted = await insertRequest({
      hotel_id,
      from_phone,
      message,
      department,
      priority,
      telnyx_id: telnyxId,
    });
    console.log('🆕 Inserted:', inserted);
  } catch (err) {
    console.error('❌ Error in POST /sms:', err);
  }

  return res.status(200).json({ success: true });
});

// PATCH /sms/:id/acknowledge — Acknowledge & send confirmation SMS
router.patch('/:id/acknowledge', async (req, res, next) => {
  try {
    const id = req.params.id.trim();
    const updated = await acknowledgeRequestById(id);
    if (!updated) return res.status(404).json({ success: false, message: 'Request not found' });

    console.log(`🔔 Sending confirmation SMS to ${updated.from_phone}`);
    let smsResult = null;
    try {
      smsResult = await sendConfirmationSms(updated.from_phone);
      console.log('📨 Telnyx response:', smsResult);
    } catch (err) {
      console.error(`❌ SMS send failed for request ${id}:`, err);
    }

    return res.status(200).json({ success: true, message: 'Acknowledged', telnyx: smsResult });
  } catch (err) {
    next(err);
  }
});

// PATCH /sms/:id/complete — Mark completed
router.patch('/:id/complete', async (req, res, next) => {
  try {
    const id = req.params.id.trim();
    const updated = await completeRequestById(id);
    if (!updated) return res.status(404).json({ success: false, message: 'Request not found' });
    return res.status(200).json({ success: true, message: 'Request marked as completed' });
  } catch (err) {
    next(err);
  }
});

// GET /sms — Return all requests (admin/debug)
router.get('/', async (req, res, next) => {
  try {
    const all = await getAllRequests();
    return res.json(all);
  } catch (err) {
    next(err);
  }
});

export default router;
