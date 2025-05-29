const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const classify = require('../classifier');

// POST /sms — Handle incoming SMS from Telnyx
router.post('/', async (req, res) => {
  console.log('✅ POST /sms route hit');
  console.log('Raw body:', req.body);

  const from = req.body?.data?.payload?.from;
  const message = req.body?.data?.payload?.text;

  if (!from || !message) {
    return res.status(400).send('Missing "from" or "text" field in Telnyx payload');
  }

  // Classify message using OpenAI
  const { department, priority } = await classify(message);

  // Save to Supabase
  const { error } = await supabase.from('HotelCrosby Requests').insert([
    {
      from,
      message,
      department,
      priority
    }
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

  const { error } = await supabase
    .from('HotelCrosby Requests')
    .update({ acknowledge: true })
    .eq('id', id);

  if (error) {
    console.error(`❌ Failed to acknowledge request:`, error.message);
    return res.status(500).send('Failed to acknowledge request');
  }

  console.log(`✅ Request ${id} acknowledged`);
  res.status(200).send('✅ Request acknowledged');
});

module.exports = router;
