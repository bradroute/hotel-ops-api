// src/routes/sms.js
import express from 'express';
import {
  supabase,
  getAllRequests,         // ← make sure to pull this in
  insertRequest,
  findByTelnyxId,
  acknowledgeRequestById,
  completeRequestById,
} from '../services/supabaseService.js';
import { sendConfirmationSms } from '../services/telnyxService.js';
import { classify } from '../services/classifier.js';

const router = express.Router();

/**
 * GET /sms
 * — returns a JSON array of all requests
 */
router.get('/', async (req, res, next) => {
  try {
    const requests = await getAllRequests();
    res.json(requests);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sms
 * — your existing inbound‐SMS webhook handler
 */
router.post('/', async (req, res) => {
  try {
    const payload = req.body?.data?.payload || {};
    const from_phone = payload.from?.phone_number;
    const to = payload.to?.[0]?.phone_number;
    const message = payload.text;
    const telnyxId = payload.id;

    if (!from_phone || !to || !message)
      return res.status(200).send('Ignored: missing fields');
    if (from_phone === process.env.TELNYX_NUMBER)
      return res.status(200).send('Ignored: outgoing confirmation');
    if (await findByTelnyxId(telnyxId))
      return res.status(200).send('Ignored: duplicate');

    const { data: hotel, error: hotelErr } = await supabase
      .from('hotels')
      .select('id')
      .eq('phone_number', to)
      .single();

    if (hotelErr || !hotel)
      return res.status(200).send('Ignored: unknown hotel number');
    const hotel_id = hotel.id;

    let department = 'General',
      priority = 'Normal';
    try {
      const c = await classify(message);
      department = c.department;
      priority = c.priority;
    } catch {}

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
  res.status(200).json({ success: true });
});

/**
 * PATCH /sms/:id/acknowledge
 */
router.patch('/:id/acknowledge', async (req, res, next) => {
  try {
    const id = req.params.id.trim();
    const updated = await acknowledgeRequestById(id);
    if (!updated)
      return res
        .status(404)
        .json({ success: false, message: 'Request not found' });

    let smsResult = null;
    try {
      smsResult = await sendConfirmationSms(updated.from_phone);
    } catch (err) {
      console.error(`❌ SMS send failed for request ${id}:`, err);
    }
    res
      .status(200)
      .json({ success: true, message: 'Acknowledged', telnyx: smsResult });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /sms/:id/complete
 */
router.patch('/:id/complete', async (req, res, next) => {
  try {
    const id = req.params.id.trim();
    const updated = await completeRequestById(id);
    if (!updated)
      return res
        .status(404)
        .json({ success: false, message: 'Request not found' });
    res
      .status(200)
      .json({ success: true, message: 'Request marked as completed' });
  } catch (err) {
    next(err);
  }
});

export default router;
