// src/routes/webform.js
const express    = require('express');
const router     = express.Router();

const classify   = require('../services/classifier');
const { supabase } = require('../services/supabaseService');

// POST /api/webform — Handle incoming form submissions
router.post('/api/webform', async (req, res, next) => {
  try {
    const { hotel_id, message } = req.body;
    if (!hotel_id || !message) {
      return res.status(400).send('Missing fields');
    }

    // classify department + priority
    let department = 'General';
    let priority   = 'Normal';
    try {
      const result = await classify(message);
      department = result.department;
      priority   = result.priority;
    } catch (err) {
      console.warn('⚠️ Classification failed, defaulting to General/Normal', err);
    }

    // save in Supabase
    await supabase
      .from('requests')
      .insert({ hotel_id, text: message, department, priority });

    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
