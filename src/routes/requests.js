import express from 'express';
const router = express.Router();

import { supabase } from '../services/supabaseService.js';

// GET /requests → return all rows from HotelCrosbyRequests
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('HotelCrosbyRequests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const formatted = data.map((row) => ({
      id: row.id,
      from: row.from,
      department: row.department,
      priority: row.priority,
      message: row.message,
      created_at: row.created_at,
      acknowledged: row.acknowledged,
      completed: row.completed,
    }));

    return res.json(formatted);
  } catch (err) {
    next(err);
  }
});

// POST /requests/:id/acknowledge → set acknowledged=true
router.post('/:id/acknowledge', async (req, res, next) => {
  const id = req.params.id;
  try {
    const { data, error } = await supabase
      .from('HotelCrosbyRequests')
      .update({ acknowledged: true })
      .eq('id', id)
      .single();

    if (error) throw error;
    return res.json({ success: true, updated: data });
  } catch (err) {
    next(err);
  }
});

// POST /requests/:id/complete → set completed=true
router.post('/:id/complete', async (req, res, next) => {
  const id = req.params.id;
  try {
    const { data, error } = await supabase
      .from('HotelCrosbyRequests')
      .update({ completed: true })
      .eq('id', id)
      .single();

    if (error) throw error;
    return res.json({ success: true, updated: data });
  } catch (err) {
    next(err);
  }
});

export default router;
