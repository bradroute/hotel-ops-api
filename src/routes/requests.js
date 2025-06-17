// src/routes/requests.js

import express from 'express';
import { asyncWrapper } from '../utils/asyncWrapper.js';
import {
  getAllRequests,
  insertRequest,
  acknowledgeRequestById,
  completeRequestById,
  getNotesByRequestId,
  addNoteToRequest,
  deleteNoteById
} from '../services/supabaseService.js';
import { sendConfirmationSms } from '../services/telnyxService.js';

const router = express.Router();

// ── List all requests (optionally filter by hotelId) ───────────────────────
router.get(
  '/',
  asyncWrapper(async (req, res) => {
    const hotelId = req.query.hotelId;
    const data = await getAllRequests(hotelId);
    res.json(data);
  })
);

// ── Create a new request ───────────────────────────────────────────────────
router.post(
  '/',
  asyncWrapper(async (req, res) => {
    const { hotel_id, from_phone, message, department, priority, telnyx_id, room_number } = req.body;
    if (!hotel_id || !message) {
      return res.status(400).json({ error: 'Missing required fields: hotel_id and message' });
    }
    const newReq = await insertRequest({
      hotel_id,
      from_phone,
      message,
      department,
      priority,
      telnyx_id,
      room_number
    });
    res.status(201).json(newReq);
  })
);

// ── Acknowledge a request and send confirmation SMS ────────────────────────
router.patch(
  '/:id/acknowledge',
  asyncWrapper(async (req, res) => {
    const id = req.params.id;
    const updated = await acknowledgeRequestById(id);
    if (!updated) return res.status(404).json({ success: false, message: 'Request not found' });

    console.log(`📨 Sending confirmation SMS for request ${id} to ${updated.from_phone}`);
    try {
      const smsResult = await sendConfirmationSms(updated.from_phone);
      console.log('📨 Telnyx response:', smsResult);
    } catch (err) {
      console.error('❌ Failed to send confirmation SMS:', err);
    }

    res.json({ success: true, updated });
  })
);

// ── Mark a request complete ────────────────────────────────────────────────
router.patch(
  '/:id/complete',
  asyncWrapper(async (req, res) => {
    const id = req.params.id;
    const updated = await completeRequestById(id);
    if (!updated) return res.status(404).json({ success: false, message: 'Request not found' });
    res.json({ success: true, updated });
  })
);

// ── Notes ──────────────────────────────────────────────────────────────────
router.get(
  '/:id/notes',
  asyncWrapper(async (req, res) => {
    const notes = await getNotesByRequestId(req.params.id);
    res.json(notes);
  })
);

router.post(
  '/:id/notes',
  asyncWrapper(async (req, res) => {
    const content = req.body.content;
    if (!content) return res.status(400).json({ error: 'Note content is required.' });
    const note = await addNoteToRequest(req.params.id, content);
    res.json({ success: true, note });
  })
);

router.delete(
  '/:id/notes/:noteId',
  asyncWrapper(async (req, res) => {
    await deleteNoteById(req.params.id, req.params.noteId);
    res.json({ success: true });
  })
);

export default router;
