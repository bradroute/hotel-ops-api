// src/routes/requests.js
import express from 'express';
import { supabase, insertRequest } from '../services/supabaseService.js';
import { acknowledgeRequestById, completeRequestById } from '../services/requestActions.js';
import { sendConfirmationSms } from '../services/telnyxService.js';
import { classify } from '../services/classifier.js';

const router = express.Router();

// Utility to normalize phone numbers for consistent matching
function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/* ──────────────────────────────────────────────────────────────
 * Create a New Guest Request
 * Accepts either:
 *  - hotel_id or propertyId
 *  - from_phone or phone_number
 *  - optional department/priority (else we classify)
 *  - room_number is REQUIRED
 * ────────────────────────────────────────────────────────────── */
router.post('/', async (req, res) => {
  try {
    const {
      hotel_id: hotelIdBody,
      propertyId,
      message,
      phone_number,          // legacy
      from_phone,            // app
      room_number,           // REQUIRED
      department: deptOverride,
      priority: prioOverride,
      source,
    } = req.body || {};

    const hotel_id = hotelIdBody || propertyId;
    const phone = from_phone || phone_number;

    if (!hotel_id || !message || !phone || !room_number) {
      return res.status(400).json({
        error: 'Missing required fields (hotel_id/propertyId, message, from_phone/phone_number, room_number).',
      });
    }

    // Classify only what we still need
    let department = deptOverride || null;
    let priority = prioOverride || null;
    let finalRoom = room_number;

    if (!department || !priority) {
      try {
        const c = await classify(message, hotel_id);
        department = department || c?.department || 'Front Desk';
        priority = priority || c?.priority || 'normal';
        // we *require* room_number from the app, but if classify extracted one,
        // keep the explicit room_number provided by the user as the source of truth.
        if (!finalRoom && c?.room_number) finalRoom = c.room_number;
      } catch (e) {
        console.warn('⚠️ classify() failed, using defaults:', e?.message || e);
        department = department || 'Front Desk';
        priority = priority || 'normal';
      }
    }

    // Ensure guest exists or update last_seen
    const { data: existingGuest } = await supabase
      .from('guests')
      .select('is_vip')
      .eq('phone_number', phone)
      .eq('hotel_id', hotel_id)
      .maybeSingle();

    // Ensure staff status
    const { data: staffData } = await supabase
      .from('authorized_numbers')
      .select('is_staff')
      .eq('phone', phone)
      .eq('hotel_id', hotel_id)
      .maybeSingle();

    const request = await insertRequest({
      hotel_id,
      from_phone: phone,
      message,
      department,
      priority,
      room_number: finalRoom,                 // required, but we keep variable for clarity
      is_staff: staffData?.is_staff || false,
      is_vip: existingGuest?.is_vip || false,
      telnyx_id: null,
      source: source || 'app_guest',
    });

    return res.status(201).json({ success: true, request });
  } catch (err) {
    console.error('❌ Failed to submit request:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

/* ──────────────────────────────────────────────────────────────
 * Get Requests (Scoped to hotel_id, optional phone filter)
 * Allows the app to show a guest’s prior requests by phone.
 * Query: ?hotel_id=... [&phone=+16515551234]
 * ────────────────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const { hotel_id, phone } = req.query;

    if (!hotel_id) {
      return res.status(400).json({ error: 'Missing hotel_id in query.' });
    }

    // Base query
    let q = supabase
      .from('requests')
      .select('*')
      .eq('hotel_id', hotel_id)
      .order('created_at', { ascending: false });

    // Optional narrow by exact phone match (client should send E.164)
    if (phone) {
      q = q.eq('from_phone', String(phone));
    }

    const { data: requests, error: reqErr } = await q;
    if (reqErr) throw reqErr;

    // Enrichment (VIP flags)
    const { data: guests = [], error: guestErr } = await supabase
      .from('guests')
      .select('phone_number, is_vip')
      .eq('hotel_id', hotel_id);
    if (guestErr) throw guestErr;

    // Enrichment (staff numbers)
    const { data: staff = [], error: staffErr } = await supabase
      .from('authorized_numbers')
      .select('phone, is_staff')
      .eq('hotel_id', hotel_id);
    if (staffErr) throw staffErr;

    const guestMap = Object.fromEntries(guests.map(g => [normalizePhone(g.phone_number), g]));
    const staffMap = Object.fromEntries(staff.filter(s => s.is_staff).map(s => [normalizePhone(s.phone), true]));

    const enriched = requests.map(r => {
      const normPhone = normalizePhone(r.from_phone);
      return {
        ...r,
        is_vip: r.is_vip || !!guestMap[normPhone]?.is_vip,
        is_staff: r.is_staff || !!staffMap[normPhone],
      };
    });

    return res.json(enriched);
  } catch (err) {
    console.error('🔥 GET /requests failed:', err);
    return res.status(500).json({ error: err.message || 'Unknown server error' });
  }
});

/* ──────────────────────────────────────────────────────────────
 * Acknowledge a Request
 * ────────────────────────────────────────────────────────────── */
router.post('/:id/acknowledge', async (req, res, next) => {
  try {
    const { hotel_id } = req.query;
    if (!hotel_id) {
      return res.status(400).json({ error: 'Missing hotel_id in query.' });
    }

    const id = req.params.id.trim();
    const updated = await acknowledgeRequestById(id, hotel_id);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    try {
      const smsResult = await sendConfirmationSms(
        updated.from_phone,
        'Operon: Your request has been received and is being worked on.'
      );
      console.log('📨 Confirmation SMS sent:', smsResult);
    } catch (smsErr) {
      console.error('❌ Confirmation SMS failed:', smsErr);
    }

    return res.json({ success: true, updated });
  } catch (err) {
    next(err);
  }
});

/* ──────────────────────────────────────────────────────────────
 * Complete a Request
 * ────────────────────────────────────────────────────────────── */
router.post('/:id/complete', async (req, res, next) => {
  try {
    const { hotel_id } = req.query;
    if (!hotel_id) {
      return res.status(400).json({ error: 'Missing hotel_id in query.' });
    }

    const id = req.params.id.trim();
    const updated = await completeRequestById(id, hotel_id);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    return res.json({ success: true, updated });
  } catch (err) {
    next(err);
  }
});

/* ──────────────────────────────────────────────────────────────
 * Notes
 * ────────────────────────────────────────────────────────────── */
router.get('/:id/notes', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id.trim(), 10);
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('request_id', id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/notes', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id.trim(), 10);
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Note content is required.' });

    const { data, error } = await supabase
      .from('notes')
      .insert({ request_id: id, content, created_at: new Date().toISOString() })
      .select();
    if (error) throw error;
    return res.json({ success: true, note: data[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/notes/:noteId', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const noteId = parseInt(req.params.noteId, 10);
    const { error } = await supabase
      .from('notes')
      .delete()
      .eq('id', noteId)
      .eq('request_id', id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
