// src/routes/sms.js

const express = require('express');
const router = express.Router();

const {
  insertRequest,
  findByTelnyxId,
  acknowledgeRequestById,
  completeRequestById,
  getAllRequests,
} = require('../services/supabaseService');

const { sendConfirmationSms } = require('../services/telnyxService');
const classify = require('../classifier');
const { asyncWrapper } = require('../utils/asyncWrapper');

// POST /sms — Handle incoming SMS from Telnyx
router.post(
  '/',
  asyncWrapper(async (req, res) => {
    console.log('✅ POST /sms route hit');

    const from = req.body?.data?.payload?.from?.phone_number;
    const message = req.body?.data?.payload?.text;
    const telnyxId = req.body?.data?.payload?.id;

    // Skip any outgoing confirmation messages from our own TELNYX_NUMBER
    if (from === process.env.TELNYX_NUMBER) {
      console.log('📤 Outgoing confirmation message detected — skipping insert.');
      return res.status(200).send('Outgoing message ignored');
    }

    // Validate required fields
    if (!from || !message) {
      return res.status(400).send('Missing "from" or "text" field in Telnyx payload');
    }

    // Skip our own confirmation text
    if (
      message ===
      'Hi! Your request has been received and is being taken care of. - Hotel Crosby'
    ) {
      console.log('📤 Outgoing confirmation message detected — skipping insert.');
      return res.status(200).send('Confirmation message skipped');
    }

    // Use OpenAI to classify department & priority
    const { department, priority } = await classify(message);

    // Check for a duplicate Telnyx ID
    const existing = await findByTelnyxId(telnyxId);
    if (existing) {
      console.log(
        `⚠️ Duplicate message detected — skipping insert for Telnyx ID: ${telnyxId}`
      );
      return res.status(200).send('Duplicate message ignored');
    }

    // Insert the new request into Supabase
    const insertedRow = await insertRequest({
      from,
      message,
      department,
      priority,
      telnyx_id: telnyxId,
    });

    console.log('🆕 Inserted row:', insertedRow);
    return res.status(200).json(insertedRow);
  })
);

// PATCH /sms/:id/acknowledge — Mark as acknowledged & send confirmation
router.patch(
  '/:id/acknowledge',
  asyncWrapper(async (req, res) => {
    const { id } = req.params;
    const trimmedId = id.toString().trim();

    // Acknowledge the request in Supabase
    const updated = await acknowledgeRequestById(trimmedId);

    // If the row wasn’t found or updated, send 404
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    // Send a confirmation SMS via Telnyx
    const smsResult = await sendConfirmationSms(updated.from);

    console.log(`✅ Request ${trimmedId} acknowledged & SMS sent`);
    return res
      .status(200)
      .json({ success: true, message: 'Acknowledged and SMS sent', telnyx: smsResult });
  })
);

// PATCH /sms/:id/complete — Mark a request as completed
router.patch(
  '/:id/complete',
  asyncWrapper(async (req, res) => {
    const { id } = req.params;
    const trimmedId = id.toString().trim();

    const updated = await completeRequestById(trimmedId);

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    return res.status(200).json({ success: true, message: 'Request marked as completed' });
  })
);

// GET /sms — Return all requests
router.get(
  '/',
  asyncWrapper(async (req, res) => {
    const all = await getAllRequests();
    return res.json(all);
  })
);

module.exports = router;
