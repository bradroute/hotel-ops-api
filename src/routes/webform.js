import express from 'express';
import { supabase } from '../services/supabaseService.js';
import { classify } from '../services/classifier.js';

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const { hotel_id, message } = req.body;
    if (!hotel_id || !message) return res.status(400).send('Missing fields');

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
      .insert({ hotel_id, message, department, priority });

    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

export default router;
