// backend/routes/webform.js
import express      from 'express';
import { classify } from '../services/classifier';
import supabase     from '../services/supabaseService';

const router = express.Router();

router.post('/api/webform', async (req, res) => {
  const { hotel_id, message } = req.body;
  if (!hotel_id || !message) return res.status(400).send('Missing fields');

  // classify department + priority
  const { department, priority } = await classify(message);

  // save in Supabase
  await supabase.from('requests').insert({
    hotel_id,
    text: message,
    department,
    priority,
  });

  res.sendStatus(200);
});

export default router;
