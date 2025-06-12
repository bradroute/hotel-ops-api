import express from 'express';
import { supabase } from '../services/supabaseService.js';
const router = express.Router();

// ── Requests CRUD ────────────────────────────────────────────────────────────

// List all requests
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

// Acknowledge a request
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

// Complete a request
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

// ── Notes CRUD ───────────────────────────────────────────────────────────────

// Get all notes for a given request
router.get('/:id/notes', async (req, res, next) => {
  try {
    const id = req.params.id;
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('request_id', id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// Add a new note to a request
router.post('/:id/notes', async (req, res, next) => {
  try {
    const id = req.params.id;
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'Note content is required.' });
    }
    const { data, error } = await supabase
      .from('notes')
      .insert([{ request_id: id, content }])
      .select();
    if (error) throw error;
    res.json({ success: true, note: data[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
