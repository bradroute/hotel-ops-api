// src/routes/requests.js
import express from 'express';
import { supabase, insertRequest } from '../services/supabaseService.js';
import { acknowledgeRequestById, completeRequestById } from '../services/requestActions.js';
import { sendConfirmationSms } from '../services/telnyxService.js';
import { classify } from '../services/classifier.js';

const router = express.Router();

// Utility to normalize phone numbers for consistent matching
function normalizePhone(phone) {
  return phone.replace(/\D/g, '');
}

// ── Create a New Guest Request ────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { hotel_id, message, phone_number, room_number } = req.body;

    if (!hotel_id || !message || !phone_number || !room_number) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const { department, priority, room_number: extractedRoom } = await classify(message, hotel_id);
    const finalRoom = extractedRoom || room_number;

    // Ensure guest exists or update last_seen
    const { data: existingGuest } = await supabase
      .from('guests')
      .select('is_vip')
      .eq('phone_number', phone_number)
      .eq('hotel_id', hotel_id)
      .maybeSingle();

    // Ensure staff status
    const { data: staffData } = await supabase
      .from('authorized_numbers')
      .select('is_staff')
      .eq('phone', phone_number)
      .eq('hotel_id', hotel_id)
      .maybeSingle();

    const request = await insertRequest({
      hotel_id,
      from_phone: phone_number,
      message,
      department,
      priority,
      room_number: finalRoom,
      is_staff: staffData?.is_staff || false,
      is_vip: existingGuest?.is_vip || false,
      telnyx_id: null
    });

    res.status(201).json({ success: true, request });
  } catch (err) {
    console.error('❌ Failed to submit request:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// ── Get All Requests (Scoped to hotel_id) ─────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { hotel_id } = req.query;

    if (!hotel_id) {
      return res.status(400).json({ error: 'Missing hotel_id in query.' });
    }

    // Fetch raw requests
    const { data: requests, error: reqErr } = await supabase
      .from('requests')
      .select('*')
      .eq('hotel_id', hotel_id)
      .order('created_at', { ascending: false });
    if (reqErr) throw reqErr;

    // Fetch guest VIP flags
    const { data: guests = [], error: guestErr } = await supabase
      .from('guests')
      .select('phone_number, is_vip')
      .eq('hotel_id', hotel_id);
    if (guestErr) throw guestErr;

    // Fetch staff numbers
    const { data: staff = [], error: staffErr } = await supabase
      .from('authorized_numbers')
      .select('phone, is_staff')
      .eq('hotel_id', hotel_id);
    if (staffErr) throw staffErr;

    const guestMap = Object.fromEntries(
      guests.map(g => [normalizePhone(g.phone_number), g])
    );
    const staffMap = Object.fromEntries(
      staff.filter(s => s.is_staff).map(s => [normalizePhone(s.phone), true])
    );

    const enriched = requests.map(r => {
      const normPhone = normalizePhone(r.from_phone);
      return {
        ...r,
        is_vip: r.is_vip || !!guestMap[normPhone]?.is_vip,
        is_staff: r.is_staff || !!staffMap[normPhone]
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error('🔥 GET /requests failed:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
});

// ── Acknowledge a Request ─────────────────────────────────────────────
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

    res.json({ success: true, updated });
  } catch (err) {
    next(err);
  }
});

// ── Complete a Request ────────────────────────────────────────────────
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

    res.json({ success: true, updated });
  } catch (err) {
    next(err);
  }
});

// ── Get, Add, Delete Notes ────────────────────────────────────────────
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
    res.json({ success: true, note: data[0] });
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
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
