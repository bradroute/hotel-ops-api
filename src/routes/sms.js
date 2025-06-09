// src/routes/sms.js

const express = require('express');
const router  = express.Router();

const {
  supabase,
  insertRequest,
  findByTelnyxId,
  acknowledgeRequestById,
  completeRequestById,
  getAllRequests,
} = require('../services/supabaseService');

const { sendConfirmationSms } = require('../services/telnyxService');
const classify = require('../classifier');


// POST /sms — Handle incoming SMS from Telnyx
router.post('/', async (req, res) => {
  // Log the entire incoming payload so we can verify its structure
  console.log('🔍 Incoming webhook body:', JSON.stringify(req.body, null, 2));
  console.log('✅ POST /sms route hit');

  try {
    const payload = req.body?.data?.payload || {};

    // Extract “from” number
    const from = payload.from?.phone_number;

    // “to” comes back as an array — use the first recipient’s phone_number
    const toArray = payload.to;
    const to = Array.isArray(toArray) && toArray.length > 0
      ? toArray[0].phone_number
      : null;

    // The actual text of the message
    const message  = payload.text;

    // Unique Telnyx message ID
    const telnyxId = payload.id;

    // Validate presence of required fields
    if (!from || !to || !message) {
      console.log('⚠️ Missing from/to/text — skipping.');
      return res.status(200).send('Ignored: missing fields');
    }

    // Skip any outgoing messages you send yourself
    if (
      from === process.env.TELNYX_NUMBER ||
      message === 'Hi! Your request has been received and is being taken care of. - Hotel Crosby'
    ) {
      console.log('📤 Outgoing/confirmation message — skipping.');
      return res.status(200).send('Ignored: outgoing confirmation');
    }

    // Deduplicate by Telnyx message ID
    if (await findByTelnyxId(telnyxId)) {
      console.log(`⚠️ Duplicate Telnyx ID ${telnyxId} — skipping.`);
      return res.status(200).send('Ignored: duplicate');
    }

    // 1️⃣ Lookup the hotel by its phone_number = “to”
    const { data: hotel, error: hotelErr } = await supabase
      .from('hotels')
      .select('id')
      .eq('phone_number', to)
      .single();

    if (hotelErr || !hotel) {
      console.warn(`⚠️ Unrecognized destination number: ${to}`);
      return res.status(200).send('Ignored: unknown hotel number');
    }
    const hotelId = hotel.id;

    // 2️⃣ Classify the request into department & priority
    let department = 'General';
    let priority   = 'Normal';
    try {
      const c = await classify(message);
      department = c.department;
      priority   = c.priority;
    } catch (err) {
      console.warn('⚠️ Classification failed, defaulting to General/Normal', err);
    }

    // 3️⃣ Insert the request, scoping it to the hotel_id
    const inserted = await insertRequest({
      hotel_id:   hotelId,
      from,
      message,
      department,
      priority,
      telnyx_id:  telnyxId,
    });
    console.log('🆕 Inserted:', inserted);

  } catch (err) {
    console.error('❌ Error in POST /sms:', err);
    // Always return 200 so Telnyx treats the webhook as delivered
  }

  return res.status(200).json({ success: true });
});


// PATCH /sms/:id/acknowledge — Mark a request as acknowledged & send confirmation SMS
router.patch('/:id/acknowledge', async (req, res, next) => {
  try {
    const id = req.params.id.trim();
    const updated = await acknowledgeRequestById(id);

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    console.log(`🔔 Sending confirmation SMS to ${updated.from}`);
    let smsResult = null;
    try {
      smsResult = await sendConfirmationSms(updated.from);
      console.log('📨 Telnyx response:', smsResult);
    } catch (err) {
      console.error(`❌ SMS send failed for request ${id}:`, err);
    }

    return res
      .status(200)
      .json({ success: true, message: 'Acknowledged', telnyx: smsResult });
  } catch (err) {
    next(err);
  }
});


// PATCH /sms/:id/complete — Mark a request as completed
router.patch('/:id/complete', async (req, res, next) => {
  try {
    const id = req.params.id.trim();
    const updated = await completeRequestById(id);

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    return res.status(200).json({ success: true, message: 'Request marked as completed' });
  } catch (err) {
    next(err);
  }
});


// GET /sms — Return all requests (for debugging/admin)
router.get('/', async (req, res, next) => {
  try {
    const all = await getAllRequests();
    return res.json(all);
  } catch (err) {
    next(err);
  }
});


module.exports = router;
