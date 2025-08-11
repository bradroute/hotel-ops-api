// src/routes/guest.js
import express from 'express';
const router = express.Router();

const DEFAULT_GEOFENCE_METERS = Number(process.env.GEOFENCE_METERS || 1609); // ~1 mile

// Haversine (meters)
function distanceMeters(a, b) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toE164(v = '') {
  const d = String(v).replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('1') ? `+${d}` : `+1${d}`;
}

// Simple health check
router.get('/ping', (_req, res) => res.json({ pong: true }));

/**
 * POST /guest/start
 * Body: { name?, phone, propertyCode, lat, lng }
 * Returns:
 *  - authorized: boolean
 *  - property_id/hotel_id: string (compat fields)
 *  - distance_m, radius_m
 *  - expires_at? (if authorized)
 *  - reason? (if not authorized)
 */
router.post('/start', async (req, res) => {
  try {
    const { name, phone, propertyCode, lat, lng } = req.body || {};

    const e164 = toE164(phone);
    if (!e164) return res.status(400).json({ error: 'invalid_phone' });
    if (!propertyCode?.trim()) return res.status(400).json({ error: 'missing_property_code' });
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'missing_coords' });
    }

    // Supabase client provided via app.locals (set in src/index.js)
    const supabase = req.app?.locals?.supabase;
    if (!supabase) return res.status(500).json({ error: 'supabase_not_initialized' });

    // Look up property by property_code (adjust table/columns if yours differ)
    const { data: property, error: pErr } = await supabase
      .from('properties')
      .select('id, property_code, latitude, longitude, is_active, geo_radius_meters')
      .eq('property_code', propertyCode.trim())
      .maybeSingle();

    if (pErr) throw pErr;
    if (!property || property.is_active === false) {
      return res.status(404).json({ error: 'property_not_found' });
    }

    const radius = Number(property.geo_radius_meters) || DEFAULT_GEOFENCE_METERS;
    const distance = distanceMeters(
      { lat, lng },
      { lat: Number(property.latitude), lng: Number(property.longitude) }
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

    // Optionally authorize the number for a limited window (24h)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // If your schema is authorized_numbers(phone, property_id, expires_at, is_staff)
    // adjust the upsert and onConflict to match your schema/indexes.
    try {
      await supabase
        .from('authorized_numbers')
        .upsert(
          {
            phone: e164,
            property_id: property.id, // if your schema uses hotel_id instead, set that too or swap column name
            is_staff: false,
            expires_at: expiresAt,
            name: name?.trim() || null,
          },
          { onConflict: 'phone,property_id' }
        );
    } catch (authErr) {
      // Don’t fail the whole request if upsert key differs; just log.
      console.error('authorized_numbers upsert warning:', authErr?.message || authErr);
    }

    // Return both property_id and hotel_id for frontend compatibility
    return res.status(200).json({
      authorized: true,
      property_id: property.id,
      hotel_id: property.id, // compat with older clients expecting hotel_id
      expires_at: expiresAt,
      distance_m: Math.round(distance),
      radius_m: radius,
    });
  } catch (e) {
    console.error('POST /guest/start error:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;
