// src/routes/verify.js
import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

// ENV you need set in Render/locally:
// TELNYX_API_KEY=...
// TELNYX_VERIFY_PROFILE_ID=...
const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const VERIFY_PROFILE_ID = process.env.TELNYX_VERIFY_PROFILE_ID;

/**
 * POST /verify/start
 * body: { phone: "+16513469559", propertyId: "uuid", name?: string, role?: "guest" }
 * returns: { sessionId }
 */
router.post('/verify/start', async (req, res) => {
  try {
    const { phone, propertyId } = req.body || {};
    if (!phone || !propertyId) {
      return res.status(400).json({ error: 'Missing phone or propertyId' });
    }

    // Dev fallback if Telnyx not configured
    if (!TELNYX_API_KEY || !VERIFY_PROFILE_ID) {
      // create a fake session id for testing
      const sessionId = `dev_${Date.now()}`;
      return res.json({ sessionId, devCode: '123456' }); // let client accept 123456 in dev
    }

    // Telnyx Verify Start
    const r = await fetch('https://api.telnyx.com/v2/verifications', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone_number: phone,
        verify_profile_id: VERIFY_PROFILE_ID,
        // channel can be 'sms' or 'call'; defaults to sms if omitted
        // channel: 'sms',
        // custom code length etc can be configured in the profile
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: data?.errors?.[0]?.detail || JSON.stringify(data) });
    }

    // Telnyx returns an id for the verification
    const sessionId = data?.data?.id;
    if (!sessionId) return res.status(500).json({ error: 'No session id from Telnyx' });

    return res.json({ sessionId });
  } catch (e) {
    console.error('verify/start error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /verify/check
 * body: { phone: "+16513469559", code: "123456" }
 * returns: { token }
 */
router.post('/verify/check', async (req, res) => {
  try {
    const { phone, code } = req.body || {};
    if (!phone || !code) {
      return res.status(400).json({ error: 'Missing phone or code' });
    }

    // Dev fallback
    if (!TELNYX_API_KEY || !VERIFY_PROFILE_ID) {
      if (code === '123456') {
        // issue a simple signed token or a random string your app will accept
        return res.json({ token: `dev_${Buffer.from(phone).toString('hex')}` });
      }
      return res.status(400).json({ error: 'Invalid code (dev expects 123456)' });
    }

    // Telnyx Verify Check
    const r = await fetch('https://api.telnyx.com/v2/verifications/by_phone_number/actions/verify', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone_number: phone,
        code,
        verify_profile_id: VERIFY_PROFILE_ID,
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: data?.errors?.[0]?.detail || JSON.stringify(data) });
    }

    // success → mint a token (jwt or opaque). Keep simple for now:
    const token = data?.data?.record_type === 'verification' ? `ok_${Date.now()}` : null;
    if (!token) return res.status(500).json({ error: 'Verification failed' });

    return res.json({ token });
  } catch (e) {
    console.error('verify/check error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
