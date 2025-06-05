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

// POST /sms — Handle incoming SMS from Telnyx
router.post('/', async (req, res) => {
  console.log('✅ POST /sms route hit');

  try {
    const from = req.body?.data?.payload?.from?.phone_number;
    const message = req.body?.data?.payload?.text;
    const telnyxId = req.body?.data?.payload?.id;

    // If no “from” or “text”, just return 200
    if (!from || !message) {
      console.log('⚠️ Missing "from" or "text" in payload. Skipping.');
      return res.status(200).send('Ignored: missing fields');
    }

    // Skip any outgoing confirmation messages from our own TELNYX_NUMBER
    if (from === process.env.TELNYX_NUMBER) {
      console.log('📤 Outgoing confirmation message detected — skipping insert.');
      return res.status(200).send('Outgoing message ignored');
    }

    // Skip our own confirmation text
    if (
      message ===
      'Hi! Your request has been received and is being taken care of. - Hotel Crosby'
    ) {
      console.log('📤 Outgoing confirmation message detected — skipping insert.');
      return res.status(200).send('Confirmation message skipped');
    }

    // Check for a duplicate Telnyx ID
    const existing = await findByTelnyxId(telnyxId);
    if (existing) {
      console.log(
        `⚠️ Duplicate message detected — skipping insert for Telnyx ID: ${telnyxId}`
      );
      return res.status(200).send('Duplicate message ignored');
    }

    // Use OpenAI to classify department & priority
    let department = 'General';
    let priority = 'Normal';
    try {
      const classification = await classify(message);
      department = classification.department;
      priority = classification.priority;
    } catch (err) {
      console.warn('⚠️ Classification failed, defaulting to General/Normal', err);
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
  } catch (err) {
    console.error('❌ Error processing inbound SMS:', err);
    // We deliberately do not return an error status to Telnyx:
    // always respond 200 so the webhook is considered “delivered.”
  }

  // Always reply 200 OK to Telnyx
  return res.status(200).json({ success: true });
});

// PATCH /sms/:id/acknowledge — Mark as acknowledged & send confirmation
router.patch('/:id/acknowledge', async (req, res, next) => {
  try {
    const { id } = req.params;
    const trimmedId = id.toString().trim();

    // Acknowledge the request in Supabase
    const updated = await acknowledgeRequestById(trimmedId);

    // If the row wasn’t found or updated, send 404
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    // Send a confirmation SMS via Telnyx
    let smsResult = null;
    try {
      smsResult = await sendConfirmationSms(updated.from);
    } catch (err) {
      console.error(`❌ Failed to send confirmation SMS for request ${trimmedId}:`, err);
    }

    console.log(`✅ Request ${trimmedId} acknowledged & SMS sent`);
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
    const { id } = req.params;
    const trimmedId = id.toString().trim();

    const updated = await completeRequestById(trimmedId);

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    return res.status(200).json({ success: true, message: 'Request marked as completed' });
  } catch (err) {
    next(err);
  }
});

// GET /sms — Return all requests
router.get('/', async (req, res, next) => {
  try {
    const all = await getAllRequests();
    return res.json(all);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
