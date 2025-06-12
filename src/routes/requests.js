// src/routes/requests.js

import express from 'express';
import {
  getAllRequests,
  acknowledgeRequestById,
  completeRequestById,
  getNotesByRequestId,
  addNoteToRequest,
} from '../services/supabaseService.js';

const router = express.Router();

// List all requests (optionally filter by hotel_id query param)
router.get('/', async (req, res, next) => {
  try {
    const hotelId = req.query.hotel_id;
    const data = await getAllRequests(hotelId);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// Acknowledge a request
router.post('/:id/acknowledge', async (req, res, next) => {
  try {
    const updated = await acknowledgeRequestById(req.params.id);
    res.json({ success: true, updated });
  } catch (err) {
    next(err);
  }
});

// Complete a request
router.post('/:id/complete', async (req, res, next) => {
  try {
    const updated = await completeRequestById(req.params.id);
    res.json({ success: true, updated });
  } catch (err) {
    next(err);
  }
});

// ── Notes Endpoints ──────────────────────────────────────────────────────────

// Get notes array for a request
router.get('/:id/notes', async (req, res, next) => {
  try {
    const notes = await getNotesByRequestId(req.params.id);
    res.json(notes);
  } catch (err) {
    next(err);
  }
});

// Add a note to a request
router.post('/:id/notes', async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'Note content is required.' });
    }
    const notes = await addNoteToRequest(req.params.id, content);
    res.json({ success: true, notes });
  } catch (err) {
    next(err);
  }
});

export default router;
