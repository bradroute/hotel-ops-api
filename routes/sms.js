const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const classifyText = require('../classifier');

router.post('/sms', async (req, res) => {
  console.log('✅ POST /sms route hit');
  console.log('📩 Raw body:', req.body);

  try {
    const { from: rawFrom, text } = req.body.data.payload;

    // Sanitize 'from' field
    const from = typeof rawFrom === 'string'
      ? rawFrom
      : rawFrom.phone_number || 'unknown';

    // Classify the message
    const { department, priority } = await classifyText(text);

    // Insert into Supabase
    const { error } = await supabase
      .from('HotelCrosby Requests')
      .insert([
        {
          from,
          message: text,
          department,
          priority,
        }
      ]);

    if (error) {
      console.error('❌ Supabase insert error:', error);
      return res.status(500).json({ error: 'Failed to insert into database' });
    }

    console.log('✅ Request successfully inserted into Supabase');
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('❌ Error processing /sms:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
