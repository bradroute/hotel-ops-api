import express from 'express';
import { supabase, insertRequest } from '../services/supabaseService.js';
import { acknowledgeRequestById, completeRequestById } from '../services/requestActions.js';
import { sendConfirmationSms } from '../services/telnyxService.js';
import { classify } from '../services/classifier.js';

const router = express.Router();

function normalizePhone(v) {
  return String(v || '').replace(/\D/g, '');
}

function parseBool(val, def = false) {
  if (val === undefined || val === null) return def;
  const s = String(val).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

// Enabled departments helper (department_settings → hotels.departments_enabled fallback)
async function getEnabledDepartments(hotel_id) {
  try {
    const { data: ds, error: dsErr } = await supabase
      .from('department_settings')
      .select('department, enabled')
      .eq('hotel_id', hotel_id);

    if (!dsErr && ds?.length) {
      const enabled = ds.filter((r) => r.enabled).map((r) => r.department);
      if (enabled.length) return enabled;
    }

    const { data: hotel, error: hErr } = await supabase
      .from('hotels')
      .select('departments_enabled')
      .eq('id', hotel_id)
      .maybeSingle();

    if (!hErr && Array.isArray(hotel?.departments_enabled)) {
      return hotel.departments_enabled;
    }
  } catch (e) {
    console.warn('[getEnabledDepartments] fallback due to error:', e?.message || e);
  }
  // sensible default
  return ['Front Desk', 'Housekeeping', 'Maintenance', 'Room Service', 'Valet'];
}

/* ──────────────────────────────────────────────────────────────
 * Preview classification (uses the SAME classifier as create)
 * POST /requests/preview { hotel_id|propertyId, message }
 * ────────────────────────────────────────────────────────────── */
router.post('/preview', async (req, res) => {
  try {
    const { hotel_id: hotelIdBody, propertyId, message } = req.body || {};
    const hotel_id = hotelIdBody || propertyId;
    if (!hotel_id || !message) {
      return res
        .status(400)
        .json({ error: 'hotel_id/propertyId and message are required.' });
    }

    const c = await classify(message, hotel_id);
    let department = c?.department || 'Front Desk';
    let priority = c?.priority || 'normal';

    // snap dept to enabled list
    const enabled = await getEnabledDepartments(hotel_id);
    if (enabled.length && !enabled.includes(department)) {
      department = enabled[0];
    }
    if (!['low', 'normal', 'urgent'].includes(String(priority))) {
      priority = 'normal';
    }

    return res.json({
      department,
      priority,
      ai_summary: c?.ai_summary || message,
      ai_entities: c?.ai_entities || {},
      confidence: c?.confidence ?? undefined,
    });
  } catch (err) {
    console.error('preview error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

/* ──────────────────────────────────────────────────────────────
 * Create a New Guest Request
 * Accepts:
 *  - hotel_id or propertyId
 *  - from_phone or phone_number
 *  - REQUIRED: room_number, message
 *  - optional department/priority (else we classify)
 * ────────────────────────────────────────────────────────────── */
router.post('/', async (req, res) => {
  try {
    const {
      hotel_id: hotelIdBody,
      propertyId,
      message,
      phone_number,
      from_phone,
      room_number,
      department: deptOverride,
      priority: prioOverride,
      source,
    } = req.body || {};

    const hotel_id = hotelIdBody || propertyId;
    const phone = from_phone || phone_number;

    if (!hotel_id || !message || !phone || !room_number) {
      return res.status(400).json({
        error:
          'Missing required fields (hotel_id/propertyId, message, from_phone/phone_number, room_number).',
      });
    }

    // Department/priority via overrides or classifier
    let department = deptOverride || null;
    let priority = prioOverride || null;

    if (!department || !priority) {
      try {
        const c = await classify(message, hotel_id);
        department = department || c?.department || 'Front Desk';
        priority = priority || c?.priority || 'normal';
      } catch (e) {
        console.warn('⚠️ classify() failed, using defaults:', e?.message || e);
        department = department || 'Front Desk';
        priority = priority || 'normal';
      }
    }

    // snap to enabled departments
    const enabled = await getEnabledDepartments(hotel_id);
    if (enabled.length && !enabled.includes(department)) {
      department = enabled[0];
    }
    if (!['low', 'normal', 'urgent'].includes(String(priority))) {
      priority = 'normal';
    }

    // Enrichment (guest VIP)
    const { data: existingGuest } = await supabase
      .from('guests')
      .select('is_vip')
      .eq('phone_number', phone)
      .eq('hotel_id', hotel_id)
      .maybeSingle();

    // Enrichment (staff)
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
      room_number: room_number, // required
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
 * /requests?hotel_id=... [&phone=+16515551234]
 * Filters (all optional):
 *   active_only=true (default)
 *   include_cancelled=false
 *   include_completed=false
 *   unacked_only=false
 * ────────────────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const { hotel_id, phone } = req.query;
    if (!hotel_id) {
      return res.status(400).json({ error: 'Missing hotel_id in query.' });
    }

    // parse booleans robustly
    const asBool = (v, def) => {
      if (v === undefined || v === null || v === '') return def;
      const s = String(v).toLowerCase();
      if (['1','true','yes','on'].includes(s)) return true;
      if (['0','false','no','off'].includes(s)) return false;
      return def;
    };

    const activeOnly        = asBool(req.query.active_only, true);
    const includeCancelled  = asBool(req.query.include_cancelled, false);
    const includeCompleted  = asBool(req.query.include_completed, false);
    const unackedOnly       = asBool(req.query.unacked_only, false);

    // base query
    let q = supabase
      .from('requests')
      .select('*')
      .eq('hotel_id', hotel_id)
      .order('created_at', { ascending: false });

    if (phone) q = q.eq('from_phone', String(phone));

    const { data: requests, error: reqErr } = await q;
    if (reqErr) throw reqErr;

    // Enrichment maps
    const { data: guests = [] } = await supabase
      .from('guests')
      .select('phone_number, is_vip')
      .eq('hotel_id', hotel_id);

    const { data: staff = [] } = await supabase
      .from('authorized_numbers')
      .select('phone, is_staff')
      .eq('hotel_id', hotel_id);

    const norm = (v) => String(v || '').replace(/\D/g, '');
    const guestMap = Object.fromEntries(guests.map(g => [norm(g.phone_number), g]));
    const staffMap = Object.fromEntries(staff.filter(s => s.is_staff).map(s => [norm(s.phone), true]));

    // Enrich
    const enriched = (requests || []).map((r) => {
      const key = norm(r.from_phone);
      return {
        ...r,
        is_vip:  r.is_vip  || !!guestMap[key]?.is_vip,
        is_staff:r.is_staff|| !!staffMap[key],
      };
    });

    // Filtering
    let filtered = enriched;

    if (activeOnly) {
      filtered = filtered.filter(r => !r.completed && !r.cancelled);
    } else {
      if (!includeCancelled) filtered = filtered.filter(r => !r.cancelled);
      if (!includeCompleted) filtered = filtered.filter(r => !r.completed);
    }

    if (unackedOnly) {
      filtered = filtered.filter(r => !r.acknowledged);
    }

    // IMPORTANT: return an ARRAY (dashboard expects array)
    return res.json(filtered);
  } catch (err) {
    console.error('🔥 GET /requests failed:', err);
    return res.status(500).json({ error: err.message || 'Unknown server error' });
  }
});

/* ──────────────────────────────────────────────────────────────
 * Get single request by id (used by guest poller)
 * /requests/:id
 * ────────────────────────────────────────────────────────────── */
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id.trim(), 10);
    const { data, error } = await supabase
      .from('requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Not found' });
    return res.json(data);
  } catch (err) {
    next(err);
  }
});

/* ──────────────────────────────────────────────────────────────
 * Acknowledge / Complete
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
