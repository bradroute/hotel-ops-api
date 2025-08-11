// src/routes/guest.js
import express from 'express';
const router = express.Router();

const GEOFENCE_METERS = Number(process.env.GEOFENCE_METERS || 1609); // ~1 mile

// Haversine (meters)
function distanceMeters(a, b) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// POST /guest/authorize  { phone, propertyId, code, lat, lng, name? } -> { token }
router.post('/guest/authorize', async (req, res) => {
  try {
    const { phone, propertyId, code, lat, lng } = req.body || {};
    if (!phone || !propertyId || !code || typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'Missing phone, propertyId, code, lat, or lng' });
    }

    // TODO: replace with your real DB call
    // Expect: properties(id, guest_code, latitude, longitude, is_active)
    const property = await req.app.locals.supabase
      ?.from('properties')
      ?.select('id, guest_code, latitude, longitude, is_active')
      ?.eq('id', propertyId)
      ?.maybeSingle()
      .then(({ data, error }) => { if (error) throw error; return data; });

    if (!property || property.is_active === false) return res.status(404).json({ error: 'Property not found' });

    if (!property.guest_code || String(code).trim() !== String(property.guest_code).trim()) {
      return res.status(401).json({ error: 'Invalid property code' });
    }

    const meters = distanceMeters(
      { lat, lng },
      { lat: Number(property.latitude), lng: Number(property.longitude) }
    );
    if (Number.isNaN(meters)) return res.status(400).json({ error: 'Invalid coordinates' });
    if (meters > GEOFENCE_METERS) return res.status(403).json({ error: `Out of range (${Math.round(meters)}m)` });

    // Mint a simple token (swap to JWT later if you want)
    const token = `guest_${propertyId}_${Buffer.from(phone).toString('hex')}_${Date.now()}`;
    return res.json({ token });
  } catch (e) {
    console.error('guest/authorize error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
