import express from 'express';
import { insertRequest } from '../services/supabaseService.js';
import { classify } from '../services/classifier.js';

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const { hotel_id, message, from_phone = null, telnyx_id = null } = req.body;
    if (!hotel_id || !message) return res.status(400).send('Missing fields');

    let department = 'General', priority = 'Normal', room_number = null;
    try {
      const result = await classify(message);
      department = result.department;
      priority = result.priority;
      room_number = result.room_number;
    } catch (err) {
      console.warn('⚠️ Classification failed, defaulting to General/Normal', err);
    }

    const newRequest = await insertRequest({
      hotel_id,
      from_phone,
      message,
      department,
      priority,
      room_number,
      telnyx_id
    });

    res.status(201).json(newRequest);
  } catch (err) {
    next(err);
  }
});

export default router;
