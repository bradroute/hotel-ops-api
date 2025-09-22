// src/routes/webform.js
import express from 'express';
import { insertRequest, getEnabledDepartments } from '../services/supabaseService.js';
import { classify } from '../services/classifier.js';

const router = express.Router();

function normalizePriority(p) {
  const v = String(p || '').toLowerCase();
  return v === 'low' || v === 'normal' || v === 'urgent' ? v : 'normal';
}

router.post('/', async (req, res, next) => {
  try {
    const {
      hotel_id,
      message,
      from_phone = null,
      room_number = null,
      space_id = null,     // optional: allow space-based requests
      telnyx_id = null,    // kept for backward compat (will mark source 'sms' if present)
    } = req.body || {};

    if (!hotel_id || !message) {
      return res.status(400).send('hotel_id and message are required.');
    }

    // Enforce one-of semantics if both are provided
    if (room_number && space_id) {
      return res.status(400).send('Provide either room_number OR space_id, not both.');
    }

    // AI classification (hotel-aware)
    let department = 'Front Desk';
    let priority = 'normal';
    let inferredRoom = null;

    try {
      const result = await classify(String(message), hotel_id);
      department   = result?.department || department;
      priority     = result?.priority   || priority;
      inferredRoom = result?.room_number ?? null;
    } catch (err) {
      console.warn('⚠️ Classification failed; using defaults:', err?.message || err);
    }

    // Snap department to hotel’s enabled list
    try {
      const enabled = await getEnabledDepartments(hotel_id);
      if (Array.isArray(enabled) && enabled.length && !enabled.includes(department)) {
        department = enabled[0];
      }
    } catch (_) {
      // non-fatal
    }

    priority = normalizePriority(priority);

    const newRequest = await insertRequest({
      hotel_id,
      from_phone, // normalized inside insertRequest
      message: String(message).trim().slice(0, 240),
      department,
      priority,
      room_number: room_number ?? inferredRoom ?? '',
      space_id: space_id ?? null,
      telnyx_id,                 // passing through keeps legacy behavior if used
      source: 'web_form',        // explicit source for analytics/routing
    });

    return res.status(201).json(newRequest);
  } catch (err) {
    next(err);
  }
});

export default router;
