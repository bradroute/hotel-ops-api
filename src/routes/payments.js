// src/routes/payments.js
console.log('🌐 PaymentsRouter mounting…');

import express from 'express';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseServiceRoleKey } from '../config/index.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Supabase (service role — make sure this route is protected!)
// ─────────────────────────────────────────────────────────────
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  realtime: { enabled: false },
});

// ─────────────────────────────────────────────────────────────
// Stripe
// ─────────────────────────────────────────────────────────────
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY) {
  console.warn('⚠️ STRIPE_SECRET_KEY is not set. Payment routes will fail.');
}

const stripe = new Stripe(STRIPE_KEY, {
  apiVersion: '2024-06-20', // pin an API version for stability
  appInfo: { name: 'Hotel Ops API' },
});

// Simple health check
router.get('/ping', (_req, res) => res.json({ pong: true }));

// Small helper: fetch profile (id, stripe_customer_id, hotel_id)
async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, stripe_customer_id, hotel_id')
    .eq('id', userId)
    .single();
  if (error) throw error;
  if (!data) throw new Error('Profile not found');
  return data;
}

// Small helper: fetch hotel (for billing details)
async function getHotel(hotelId) {
  if (!hotelId) return null;
  const { data, error } = await supabase
    .from('hotels')
    .select('name,address,city,state,zip_code,phone_number')
    .eq('id', hotelId)
    .single();
  if (error) throw error;
  return data || null;
}

/**
 * 1) Get or create Stripe customer (handles deleted/missing customers)
 *    Body: { userId }
 *    Returns: { customerId }
 */
router.post('/get-or-create-customer', async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const profile = await getProfile(userId);

    let customerId = profile.stripe_customer_id;
    let needCreate = false;

    if (customerId) {
      try {
        const cust = await stripe.customers.retrieve(customerId);
        if (cust?.deleted) needCreate = true;
      } catch (err) {
        // If the customer no longer exists in Stripe
        if (err?.code === 'resource_missing') needCreate = true;
        else throw err;
      }
    } else {
      needCreate = true;
    }

    if (needCreate) {
      const hotel = await getHotel(profile.hotel_id).catch(() => null);

      const customer = await stripe.customers.create({
        name: hotel?.name || `HotelOps User ${userId}`,
        phone: hotel?.phone_number || undefined,
        address: hotel
          ? {
              line1: hotel.address || undefined,
              city: hotel.city || undefined,
              state: hotel.state || undefined,
              postal_code: hotel.zip_code || undefined,
              country: 'US',
            }
          : undefined,
        metadata: { userId: String(userId) },
      });

      customerId = customer.id;

      const { error: updErr } = await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId);
      if (updErr) throw updErr;
    } else {
      // Ensure metadata has userId for traceability
      try {
        await stripe.customers.update(customerId, {
          metadata: { userId: String(userId) },
        });
      } catch (e) {
        // Non-fatal
        console.warn('⚠️ Could not update customer metadata:', e?.message || e);
      }
    }

    return res.json({ customerId });
  } catch (err) {
    console.error('get-or-create-customer:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

/**
 * 2) Create a SetupIntent for saving a card (off-session)
 *    Body: { customerId }
 *    Returns: { clientSecret }
 */
router.post('/create-setup-intent', async (req, res) => {
  try {
    const { customerId } = req.body || {};
    if (!customerId) return res.status(400).json({ error: 'Missing customerId' });

    const si = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
    });

    return res.json({ clientSecret: si.client_secret });
  } catch (err) {
    console.error('create-setup-intent:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

/**
 * 3) List saved card payment methods for a customer
 *    Params: :customerId
 *    Returns: { paymentMethods: [...] }
 */
router.get('/list-payment-methods/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params || {};
    if (!customerId) return res.status(400).json({ error: 'Missing customerId' });

    const methods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });

    return res.json({ paymentMethods: methods.data });
  } catch (err) {
    console.error('list-payment-methods:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

/**
 * 4) Set default payment method for user (DB + Stripe customer settings)
 *    Body: { userId, paymentMethodId }
 *    Returns: { success: true }
 */
router.post('/set-default-payment-method', async (req, res) => {
  try {
    const { userId, paymentMethodId } = req.body || {};
    if (!userId || !paymentMethodId) {
      return res.status(400).json({ error: 'Missing userId or paymentMethodId' });
    }

    const profile = await getProfile(userId);
    if (!profile.stripe_customer_id) {
      return res.status(400).json({ error: 'No Stripe customer for this user' });
    }

    const customerId = profile.stripe_customer_id;

    // Ensure the PM is attached to the customer
    try {
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      if (pm.customer && pm.customer !== customerId) {
        return res.status(400).json({ error: 'Payment method belongs to a different customer' });
      }
      if (!pm.customer) {
        await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
      }
    } catch (e) {
      return res.status(400).json({ error: e.message || 'Invalid payment method' });
    }

    // Set as default on the Stripe customer
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // Persist in our DB (optional but useful for display)
    const { error } = await supabase
      .from('profiles')
      .update({ default_payment_method_id: paymentMethodId })
      .eq('id', userId);
    if (error) throw error;

    return res.json({ success: true });
  } catch (err) {
    console.error('set-default-payment-method:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

export default router;

/* ─────────────────────────────────────────────────────────────
   ⚠️ NOTE ABOUT STRIPE WEBHOOKS
   If/when you add a webhook, mount it BEFORE express.json() in
   src/index.js, e.g.:

   // BEFORE app.use(express.json())
   import paymentsWebhook from './routes/paymentsWebhook.js';
   app.post('/api/stripe/webhook',
     express.raw({ type: 'application/json' }),
     paymentsWebhook
   );

   Stripe signature verification requires the raw body.
   Your current global express.json() would otherwise break it.
────────────────────────────────────────────────────────────── */
