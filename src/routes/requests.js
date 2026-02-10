// src/routes/requests.js
import express from 'express';
import {
  supabaseAdmin as supabase,
  insertRequest,
  getEnabledDepartments,
} from '../services/supabaseService.js';
import { acknowledgeRequestById, completeRequestById } from '../services/requestActions.js';
import { classify } from '../services/classifier.js';
import { notifyStaffOnNewRequest } from '../services/notificationService.js';
import { logRequestEvent } from '../services/auditLog.js';
import { validate } from '../middleware/validate.js';
import {
  previewBody,
  createRequestBody,
  listRequestsQuery,
  requestIdParams,
  hotelIdQuery,
  createNoteBody,
  noteIdParams,
  patchRequestBody,
} from '../schemas/requests.js';
import logger from '../lib/logger.js';

const router = express.Router();

/* ───────────────────────── helpers ───────────────────────── */
function digits(v) {
  return String(v || '').replace(/\D/g, '');
}
function toE164(v = '') {
  const d = digits(v);
  if (!d) return '';
  return d.startsWith('1') ? `+${d}` : `+1${d}`;
}
function normalizePriority(p) {
  const v = String(p || '').toLowerCase();
  if (v === 'low' || v === 'normal' || v === 'urgent') return v;
  return 'normal';
}

/* ── Preview classification ─────────────────────────────────── */
router.post('/preview', validate({ body: previewBody }), async (req, res) => {
  try {
    const { hotel_id: hotelIdBody, propertyId, message } = req.body;
    const hotel_id = hotelIdBody || propertyId;

    const c = await classify(message, hotel_id).catch((e) => {
      logger.warn({ err: e }, 'preview classify failed');
      return null;
    });

    let department = c?.department || 'Front Desk';
    let priority = normalizePriority(c?.priority);

    const enabled = await getEnabledDepartments(hotel_id).catch(() => []);
    if (enabled.length && !enabled.includes(department)) {
      department = enabled[0];
    }

    return res.json({
      department,
      priority,
      ai_summary: c?.ai_summary || message,
      ai_entities: c?.ai_entities || {},
      confidence: c?.confidence ?? undefined,
    });
  } catch (err) {
    logger.error({ err }, 'preview error');
    return res.status(500).json({ error: 'server_error' });
  }
});

/* ── Create a New Guest/Staff Request ─────────────────────────
   Accepts EITHER room_number OR space_id (not both).
---------------------------------------------------------------- */
router.post('/', validate({ body: createRequestBody }), async (req, res) => {
  try {
    const {
      hotel_id: hotelIdBody,
      propertyId,
      message,
      phone_number,
      from_phone,
      room_number,
      space_id,
      department: deptOverride,
      priority: prioOverride,
      source,
    } = req.body;

    const hotel_id = hotelIdBody || propertyId;
    const inputPhone = from_phone || phone_number;

    const hasRoom = !!(room_number && String(room_number).trim());
    const hasSpace = !!space_id;
    if (hasRoom === hasSpace) {
      return res.status(400).json({ error: 'Provide exactly one of: room_number OR space_id.' });
    }

    const phoneE164 = toE164(inputPhone);

    // Validate space_id belongs to this hotel (if provided)
    let finalSpaceId = null;
    let finalRoomLabel = '';
    if (hasSpace) {
      const { data: spaceRow, error: spaceErr } = await supabase
        .from('hotel_spaces')
        .select('id, hotel_id, name, is_active')
        .eq('id', space_id)
        .eq('hotel_id', hotel_id)
        .maybeSingle();
      if (spaceErr || !spaceRow || spaceRow.is_active === false) {
        return res.status(404).json({ error: 'Space not found at this property.' });
      }
      finalSpaceId = spaceRow.id;
      finalRoomLabel = spaceRow.name;
    } else {
      finalRoomLabel = String(room_number).trim();
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
        logger.warn({ err: e }, 'classify() failed, using defaults');
        department = department || 'Front Desk';
        priority = priority || 'normal';
      }
    }

    // Snap to enabled departments + normalize priority
    const enabled = await getEnabledDepartments(hotel_id).catch(() => []);
    if (enabled.length && !enabled.includes(department)) {
      department = enabled[0];
    }
    priority = normalizePriority(priority);

    // Enrichment (guest VIP)
    const { data: existingGuest } = await supabase
      .from('guests')
      .select('is_vip')
      .eq('phone_number', phoneE164)
      .eq('hotel_id', hotel_id)
      .maybeSingle();

    // Enrichment (staff)
    const { data: staffData } = await supabase
      .from('authorized_numbers')
      .select('is_staff')
      .eq('phone', phoneE164)
      .eq('hotel_id', hotel_id)
      .maybeSingle();

    const request = await insertRequest({
      hotel_id,
      from_phone: phoneE164,
      message: String(message).trim().slice(0, 240),
      department,
      priority,
      room_number: hasRoom ? finalRoomLabel : '',
      space_id: hasSpace ? finalSpaceId : null,
      is_staff: !!staffData?.is_staff,
      is_vip: !!existingGuest?.is_vip,
      telnyx_id: null,
      source: source || 'app_guest',
    });

    // Triggers log 'created' automatically — no explicit audit call here.

    notifyStaffOnNewRequest(request).catch((e) =>
      logger.warn({ err: e }, 'notifyStaffOnNewRequest failed')
    );

    return res.status(201).json({
      success: true,
      request: {
        id: request.id,
        created_at: request.created_at,
        room_number: request.room_number,
        space_id: request.space_id,
        department: request.department,
        priority: request.priority,
        source: request.source,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to submit request');
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

/* ── Get Requests ───────────────────────────────────────────── */
router.get('/', validate({ query: listRequestsQuery }), async (req, res) => {
  try {
    const { hotel_id, phone, show_active_only } = req.query;

    let q = supabase
      .from('requests')
      .select('*')
      .eq('hotel_id', hotel_id)
      .order('created_at', { ascending: false });

    if (String(show_active_only ?? '1') !== '0') {
      q = q.eq('cancelled', false).eq('completed', false);
    }

    if (phone) q = q.eq('from_phone', toE164(phone));

    const { data: requests, error: reqErr } = await q;
    if (reqErr) throw reqErr;

    // Enrichment (VIP/staff flags)
    const { data: guests = [], error: guestErr } = await supabase
      .from('guests')
      .select('phone_number, is_vip')
      .eq('hotel_id', hotel_id);
    if (guestErr) throw guestErr;

    const { data: staff = [], error: staffErr } = await supabase
      .from('authorized_numbers')
      .select('phone, is_staff')
      .eq('hotel_id', hotel_id);
    if (staffErr) throw staffErr;

    const guestMap = Object.fromEntries((guests || []).map((g) => [digits(g.phone_number), g]));
    const staffMap = Object.fromEntries(
      (staff || []).filter((s) => s.is_staff).map((s) => [digits(s.phone), true])
    );

    const enriched = (requests || []).map((r) => {
      const normPhone = digits(r.from_phone);
      return {
        ...r,
        is_vip: r.is_vip || !!guestMap[normPhone]?.is_vip,
        is_staff: r.is_staff || !!staffMap[normPhone],
      };
    });

    return res.json(enriched);
  } catch (err) {
    logger.error({ err }, 'GET /requests failed');
    return res.status(500).json({ error: err.message || 'Unknown server error' });
  }
});

/* ── Acknowledge / Complete ───────────────────────────────────
   DB triggers log 'acknowledged' and 'completed' automatically.
---------------------------------------------------------------- */
router.post(
  '/:id/acknowledge',
  validate({ params: requestIdParams, query: hotelIdQuery }),
  async (req, res, next) => {
    try {
      const { hotel_id } = req.query;
      const id = parseInt(String(req.params.id).trim(), 10);

      const updated = await acknowledgeRequestById(id, hotel_id);
      if (!updated) return res.status(404).json({ success: false, message: 'Request not found' });

      return res.json({ success: true, updated });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/complete',
  validate({ params: requestIdParams, query: hotelIdQuery }),
  async (req, res, next) => {
    try {
      const { hotel_id } = req.query;
      const id = parseInt(String(req.params.id).trim(), 10);

      const updated = await completeRequestById(id, hotel_id);
      if (!updated) return res.status(404).json({ success: false, message: 'Request not found' });

      return res.json({ success: true, updated });
    } catch (err) {
      next(err);
    }
  }
);

/* ── Notes ────────────────────────────────────────────────────
   DB trigger logs 'note_added' on insert.
---------------------------------------------------------------- */
router.get('/:id/notes', validate({ params: requestIdParams }), async (req, res, next) => {
  try {
    const id = parseInt(String(req.params.id).trim(), 10);
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('request_id', id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return res.json(data || []);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/notes',
  validate({ params: requestIdParams, body: createNoteBody }),
  async (req, res, next) => {
    try {
      const id = parseInt(String(req.params.id).trim(), 10);
      const { content } = req.body;

      const { data, error } = await supabase
        .from('notes')
        .insert({ request_id: id, content, created_at: new Date().toISOString() })
        .select()
        .single();
      if (error) throw error;
      return res.json({ success: true, note: data });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:id/notes/:noteId',
  validate({ params: noteIdParams }),
  async (req, res, next) => {
    try {
      const id = parseInt(String(req.params.id).trim(), 10);
      const noteId = parseInt(String(req.params.noteId).trim(), 10);
      const { error } = await supabase.from('notes').delete().eq('id', noteId).eq('request_id', id);
      if (error) throw error;
      return res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

/* ── History (read-only) ────────────────────────────────────── */
router.get('/:id/history', validate({ params: requestIdParams }), async (req, res, next) => {
  try {
    const id = parseInt(String(req.params.id).trim(), 10);
    const { data, error } = await supabase
      .from('request_logs')
      .select(
        'id, action, from_status, to_status, from_priority, to_priority, from_department, to_department, actor_label, note, metadata, created_at'
      )
      .eq('request_id', id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json(data || []);
  } catch (err) {
    next(err);
  }
});

/* ── Patch select fields + log (no overlap with trigger-logged fields) ──
   Allowed: summary, root_cause, escalation_reason, estimated_revenue, needs_attention
-------------------------------------------------------------------------- */
router.patch(
  '/:id',
  validate({ params: requestIdParams, body: patchRequestBody }),
  async (req, res, next) => {
    try {
      const id = parseInt(String(req.params.id).trim(), 10);

      const allow = ['summary', 'root_cause', 'escalation_reason', 'estimated_revenue', 'needs_attention'];
      const patch = Object.fromEntries(
        Object.entries(req.body || {}).filter(([k, v]) => allow.includes(k) && v !== undefined)
      );

      if (!Object.keys(patch).length) {
        return res.status(400).json({ error: 'No allowed fields provided.' });
      }

      // fetch for hotel_id
      const { data: cur, error: fErr } = await supabase
        .from('requests')
        .select('id, hotel_id')
        .eq('id', id)
        .single();
      if (fErr || !cur) return res.status(404).json({ error: 'not_found' });

      const { data, error } = await supabase
        .from('requests')
        .update(patch)
        .eq('id', id)
        .select('id')
        .single();
      if (error) return res.status(400).json({ error: error.message });

      // explicit audit for free-form fields
      await logRequestEvent({
        request_id: id,
        hotel_id: cur.hotel_id,
        action: 'field_changed',
        actor_user_id: req.user?.id ?? null,
        actor_label: 'Staff',
        metadata: { patch },
      });

      return res.json({ success: true, id: data.id });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
