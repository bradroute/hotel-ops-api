import express from 'express';
import { supabase } from '../services/supabaseService.js';
const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/acknowledge', async (req, res, next) => {
  try {
    const id = req.params.id;
    const { data, error } = await supabase
      .from('requests')
      .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json({ success: true, updated: data[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/complete', async (req, res, next) => {
  try {
    const id = req.params.id;
    const { data, error } = await supabase
      .from('requests')
      .update({ completed: true, completed_at: new Date().toISOString() })
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json({ success: true, updated: data[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
