// src/routes/requests.js

import express from 'express';
import { supabase } from '../services/supabaseService.js';
import {
  acknowledgeRequestById,
  completeRequestById
} from '../services/requestActions.js';
import { sendConfirmationSms } from '../services/telnyxService.js';

const router = express.Router();

// List all requests, enriched with VIP and staff flags
router.get('/', async (req, res, next) => {
  try {
    const { data: requests, error: reqErr } = await supabase
      .from('requests')
      .select('*')
      .order('created_at', { ascending: false });
    if (reqErr) throw reqErr;

    const { data: guests, error: guestErr } = await supabase
      .from('guests')
      .select('phone_number, is_vip, is_staff');
    if (guestErr) throw guestErr;

    const guestMap = {};
    guests.forEach(g => {
      guestMap[g.phone_number] = {
        is_vip: g.is_vip,
        is_staff: g.is_staff
      };
    });

    const enriched = requests.map(r => ({
      ...r,
      is_vip: !!guestMap[r.from_phone]?.is_vip,
      is_staff: !!guestMap[r.from_phone]?.is_staff
    }));

    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

// Acknowledge a request (and send confirmation SMS)
router.post('/:id/acknowledge', async (req, res, next) => {
  try {
    const id = req.params.id.trim();
    const updated = await acknowledgeRequestById(id);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    console.log(`📣 [requests] Request ${id} acknowledged. Now sending confirmation SMS to ${updated.from_phone}…`);
    try {
      const smsResult = await sendConfirmationSms(updated.from_phone);
      console.log('📨 [requests] Confirmation SMS sent:', smsResult);
    } catch (smsErr) {
      console.error('❌ [requests] Confirmation SMS failed:', smsErr);
    }

    res.json({ success: true, updated });
  } catch (err) {
    next(err);
  }
});

// Complete a request
router.post('/:id/complete', async (req, res, next) => {
  try {
    const id = req.params.id.trim();
    const updated = await completeRequestById(id);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    res.json({ success: true, updated });
  } catch (err) {
    next(err);
  }
});

// GET all notes for a given request
router.get('/:id/notes', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id.trim(), 10);
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('request_id', id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// Add new note to request (with debug logging and .select())
router.post('/:id/notes', async (req, res, next) => {
  console.log('📝 [notes] POST body:', req.body, 'params:', req.params);
  try {
    const id = parseInt(req.params.id.trim(), 10);
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'Note content is required.' });
    }
    const { data, error } = await supabase
      .from('notes')
      .insert({ request_id: id, content, created_at: new Date().toISOString() })
      .select();
    if (error) throw error;
    console.log('📝 [notes] Created note:', data);
    res.json({ success: true, note: data[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE note from request (with debug logging)
router.delete('/:id/notes/:noteId', async (req, res, next) => {
  console.log('🗑 [notes] DELETE params:', req.params);
  try {
    const id = parseInt(req.params.id, 10);
    const noteId = parseInt(req.params.noteId, 10);
    const { error } = await supabase
      .from('notes')
      .delete()
      .eq('id', noteId)
      .eq('request_id', id);
    if (error) throw error;
    console.log(`🗑 [notes] Deleted note ${noteId} from request ${id}`);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
