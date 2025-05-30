const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const classify = require('../classifier');
const fetch = require('node-fetch');

// POST /sms — Handle incoming SMS from Telnyx
router.post('/', async (req, res) => {
  console.log('✅ POST /sms route hit');
  console.log('Raw body:', req.body);

  const from = req.body?.data?.payload?.from?.phone_number;
  const message = req.body?.data?.payload?.text;

  if (!from || !message) {
    return res.status(400).send('Missing "from" or "text" field in Telnyx payload');
  }

  // Classify message using OpenAI
  const { department, priority } = await classify(message);

  // Save to Supabase
  const { error } = await supabase.from('HotelCrosbyRequests').insert([
    { from, message, department, priority }
  ]);

  if (error) {
    console.error('❌ Error inserting SMS:', error.message);
    return res.status(500).send('Failed to log request');
  }

  res.status(200).send('✅ Request logged');
});

// PATCH /sms/:id/acknowledge — Mark a message as acknowledged
router.patch('/:id/acknowledge', async (req, res) => {
  const { id } = req.params;
  const trimmedId = id.toString().trim(); // force string and trim whitespace
  console.log('🔍 Raw ID:', id);
  console.log('🧼 Trimmed ID:', trimmedId);

  // Step 1: Get the request from Supabase
  const { data, error: fetchError } = await supabase
    .from('HotelCrosbyRequests')
    .select('*')
    .eq('id', trimmedId)
    .maybeSingle();

  console.log('📦 Supabase data:', data);
  console.log('❌ Fetch error (if any):', fetchError);

  if (fetchError) {
    console.error('❌ Fetch error:', fetchError.message);
    return res.status(500).json({ success: false, message: 'Fetch error' });
  }

  if (!data) {
    console.error('❌ Request not found for ID:', trimmedId);
    return res.status(404).json({ success: false, message: 'Request not found' });
  }

  // Step 2: Mark as acknowledged in Supabase
  const { error: updateError } = await supabase
    .from('HotelCrosbyRequests')
    .update({ acknowledged: true })
    .eq('id', trimmedId);

  if (updateError) {
    console.error('❌ Failed to acknowledge request:', updateError.message);
    return res.status(500).json({ success: false, message: 'Failed to update request' });
  }

  // Step 3: Send SMS back to guest using Telnyx
  try {
    const smsResponse = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.TELNYX_NUMBER,
        to: data.from,
        text: `Hi! Your request has been received and is being taken care of. - Hotel Crosby`
      })
    });

    if (!smsResponse.ok) {
      const errorText = await smsResponse.text();
      console.error('⚠️ SMS send failed:', errorText);
      return res.status(500).json({ success: false, message: 'Acknowledged, but SMS failed' });
    }

    console.log(`✅ Request ${trimmedId} acknowledged & SMS sent`);
    return res.status(200).json({ success: true, message: 'Acknowledged and SMS sent' });
  } catch (err) {
    console.error('❌ Telnyx API error:', err.message);
    return res.status(500).json({ success: false, message: 'Error sending SMS' });
  }
});

module.exports = router;
