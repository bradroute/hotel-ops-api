// src/routes/requests.js
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const router = express.Router();

// GET /requests → return all requests with `from` taken directly from the column
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    // Since your table column is named "from", just pass it along:
    const formatted = data.map((row) => ({
      id: row.id,
      from: row.from,           // <-- use row.from, not row.from_phone
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
  const id = parseInt(req.params.id, 10);
  try {
    const { data, error } = await supabase
      .from('requests')
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
  const id = parseInt(req.params.id, 10);
  try {
    const { data, error } = await supabase
      .from('requests')
      .update({ completed: true })
      .eq('id', id)
      .single();

    if (error) throw error;
    return res.json({ success: true, updated: data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
