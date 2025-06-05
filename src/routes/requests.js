// src/routes/requests.js
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const router = express.Router();

// GET /requests → return all requests
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// POST /requests/:id/acknowledge → set acknowledged=true and send SMS, etc.
router.post('/:id/acknowledge', async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  try {
    // Update the “acknowledged” flag in Supabase
    const { data, error } = await supabase
      .from('requests')
      .update({ acknowledged: true })
      .eq('id', id)
      .single();

    if (error) throw error;

    // (Optional) Send an SMS here if you want, using your Telnyx logic

    res.json({ success: true, updated: data });
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
    res.json({ success: true, updated: data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
