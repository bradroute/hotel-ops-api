// src/routes/requests.js
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const router = express.Router();

// GET /requests → return all rows from HotelCrosbyRequests
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('HotelCrosbyRequests')            // ← correct table name here
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Map each row exactly as your frontend expects
    const formatted = data.map((row) => ({
      id: row.id,
      from: row.from,                         // your column is named “from”
      department: row.department,
      priority: row.priority,
      message: row.message,
      created_at: row.created_at,
      acknowledged: row.acknowledged,
      completed: row.completed,               // or row.completed_at !== null if you want a boolean
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
      .from('HotelCrosbyRequests')            // ← same table here
      .update({ acknowledged: true })
      .eq('id', id)
      .single();

    if (error) throw error;
    return res.json({ success: true, updated: data });
  } catch (err) {
    next(err);
  }
});

// POST /requests/:id/complete → set completed=true (or set completed_at to now)
router.post('/:id/complete', async (req, res, next) => {
  const id = req.params.id;
  try {
    const { data, error } = await supabase
      .from('HotelCrosbyRequests')            // ← and here
      .update({ completed: true })            // or .update({ completed_at: new Date() })
      .eq('id', id)
      .single();

    if (error) throw error;
    return res.json({ success: true, updated: data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
