// src/routes/guest.js
import express from 'express';
import { randomUUID } from 'crypto';

const router = express.Router();

const DEFAULT_GEOFENCE_METERS = Number(process.env.GEOFENCE_METERS || 1609); // ~1 mile
const DEFAULT_DEPTS = ['Front Desk', 'Housekeeping', 'Maintenance', 'Room Service', 'Valet'];

/* ───────────────────────── helpers ───────────────────────── */

function distanceMeters(a, b) {
  // Haversine (meters)
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toE164(v = '') {
  const d = String(v).replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('1') ? `+${d}` : `+1${d}`;
}

function createGuestToken() {
  // simple opaque token; swap to JWT later if needed
  return `gst_${randomUUID()}`;
}

/* ───────────────────────── routes ───────────────────────── */

router.get('/ping', (_req, res) => res.json({ pong: true }));

/**
 * GET /guest/properties/:hotelId/departments
 * Returns enabled departments for the property.
 * Read order: department_settings.enabled=true → profiles.enabled_departments → hotels.departments_enabled → defaults
 * Always 200 with a list (fail-safe).
 */
router.get('/properties/:hotelId/departments', async (req, res) => {
  const { hotelId } = req.params;
  const supabaseAdmin = req.app?.locals?.supabaseAdmin; // service role
  const supabase = req.app?.locals?.supabase;           // anon/public

  const ok = (list) =>
    res.status(200).json({
      departments: Array.isArray(list) && list.length ? list : DEFAULT_DEPTS,
    });

  try {
    // 1) department_settings.enabled = true (admin)
    if (supabaseAdmin) {
      const { data: depRows, error: depErr } = await supabaseAdmin
        .from('department_settings')
        .select('department')
        .eq('hotel_id', hotelId)
        .eq('enabled', true);

      if (!depErr && depRows?.length) {
        return ok(depRows.map((r) => r.department));
      }
      if (depErr) console.warn('[DEPTS] department_settings read failed:', depErr);
    } else {
      console.warn('[DEPTS] supabaseAdmin missing; skipping department_settings');
    }

    // 2) profiles.enabled_departments (admin)
    if (supabaseAdmin) {
      const { data: prof, error: profErr } = await supabaseAdmin
        .from('profiles')
        .select('enabled_departments')
        .eq('hotel_id', hotelId)
        .maybeSingle();

      if (!profErr && Array.isArray(prof?.enabled_departments) && prof.enabled_departments.length) {
        return ok(prof.enabled_departments);
      }
      if (profErr) console.warn('[DEPTS] profiles fallback failed:', profErr);
    }

    // 3) hotels.departments_enabled (anon)
    if (supabase) {
      const { data: hotel, error: hotelErr } = await supabase
        .from('hotels')
        .select('departments_enabled')
        .eq('id', hotelId)
        .maybeSingle();

      if (!hotelErr && Array.isArray(hotel?.departments_enabled)) {
        return ok(hotel.departments_enabled);
      }
      if (hotelErr) console.warn('[DEPTS] hotels fallback failed:', hotelErr);
    } else {
      console.warn('[DEPTS] supabase anon client missing; using defaults');
    }

    // 4) defaults
    return ok(DEFAULT_DEPTS);
  } catch (err) {
    console.error('[DEPTS] unexpected error:', err);
    return ok(DEFAULT_DEPTS);
  }
});

/**
 * POST /guest/start
 * Body: { name?, phone, propertyCode, lat, lng }
 *  - propertyCode must match hotels.guest_code
 * Returns:
 *  {
 *    authorized: boolean,
 *    hotel_id?, distance_m?, radius_m?, expires_at?, reason?,
 *    token?, popt?
 *  }
 */
router.post('/start', async (req, res) => {
  try {
    const { name, phone, propertyCode, lat, lng } = req.body || {};
    const supabase = req.app?.locals?.supabase;           // anon
    const supabaseAdmin = req.app?.locals?.supabaseAdmin; // service role

    if (!supabase || !supabaseAdmin) {
      return res.status(500).json({ error: 'supabase_not_initialized' });
    }

    const e164 = toE164(phone);
    if (!e164) return res.status(400).json({ error: 'invalid_phone' });
    if (!propertyCode?.trim()) return res.status(400).json({ error: 'missing_property_code' });
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'missing_coords' });
    }

    // Lookup hotel by guest_code
    const { data: hotel, error: hErr } = await supabase
      .from('hotels')
      .select('id, guest_code, latitude, longitude, is_active')
      .eq('guest_code', propertyCode.trim())
      .maybeSingle();

    if (hErr) {
      console.error('[guest/start] hotels lookup error:', hErr);
      return res.status(500).json({ error: 'db_error' });
    }
    if (!hotel || hotel.is_active === false) {
      return res.status(404).json({ error: 'hotel_not_found' });
    }

    // Geofence
    const radius = DEFAULT_GEOFENCE_METERS;
    const distance = distanceMeters(
      { lat, lng },
      { lat: Number(hotel.latitude), lng: Number(hotel.longitude) }
    );
    if (Number.isNaN(distance)) return res.status(400).json({ error: 'invalid_coords' });

    if (distance > radius) {
      return res.status(200).json({
        authorized: false,
        reason: 'outside_radius',
        distance_m: Math.round(distance),
        radius_m: radius,
      });
    }

    // Authorize phone for 24h (phone is PK in authorized_numbers)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const upsertRow = {
      phone: e164,
      hotel_id: hotel.id,
      is_staff: false,
      expires_at: expiresAt,
      // room_number: null,
    };

    const { error: aErr } = await supabase
      .from('authorized_numbers')
      .upsert(upsertRow, { onConflict: 'phone' });

    if (aErr) console.error('[guest/start] authorized_numbers upsert error:', aErr);

    // Create a guest session token
    const token = createGuestToken();
    const { error: sErr } = await supabaseAdmin
      .from('guest_sessions')
      .insert([{
        token,
        hotel_id: hotel.id,
        room_number: null,
        phone_number: e164,
        expires_at: expiresAt,
      }]);

    if (sErr) {
      console.error('[guest/start] guest_sessions insert error:', sErr);
      // non-fatal; still return authorized
    }

    return res.status(200).json({
      authorized: true,
      hotel_id: hotel.id,
      expires_at: expiresAt,
      distance_m: Math.round(distance),
      radius_m: radius,
      token,     // for app flow
      popt: '',  // reserved header if your API expects it
    });
  } catch (e) {
    console.error('POST /guest/start error:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;
