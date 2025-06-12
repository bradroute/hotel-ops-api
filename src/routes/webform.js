import express from 'express';
const router = express.Router();

import { classify } from '../services/classifier.js';
import { supabase } from '../services/supabaseService.js';

// POST /api/webform — Handle incoming form submissions
router.post('/api/webform', async (req, res, next) => {
  try {
    const { hotel_id, message } = req.body;
    if (!hotel_id || !message) {
      return res.status(400).send('Missing fields');
    }

    let department = 'General';
    let priority = 'Normal';
    try {
      const result = await classify(message);
      department = result.department;
      priority = result.priority;
    } catch (err) {
      console.warn('⚠️ Classification failed, defaulting to General/Normal', err);
    }

    await supabase
      .from('requests')
      .insert({ hotel_id, text: message, department, priority });

    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

export default router;
