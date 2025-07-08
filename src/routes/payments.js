// hotel-ops-api/src/routes/payments.js
console.log('🌐 PaymentsRouter mounting…');

import express from 'express';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseServiceRoleKey } from '../config/index.js';

// Initialize Supabase client (service role)
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Quick health-check endpoint
router.get('/ping', (req, res) => {
  res.json({ pong: true });
});

// 1) get-or-create-customer, now handles deleted Stripe customers
router.post('/get-or-create-customer', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    // fetch profile to get existing Stripe customer ID and hotel
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('stripe_customer_id, hotel_id')
      .eq('id', userId)
      .single();
    if (profErr) throw profErr;

    let customerId = profile?.stripe_customer_id;
    let createNew = false;

    if (customerId) {
      // verify that customer still exists (and is not deleted) in Stripe
      try {
        const existing = await stripe.customers.retrieve(customerId);
        if (existing.deleted) {
          createNew = true;
        }
      } catch (err) {
        // if customer truly missing, flag to create new
        if (err.code === 'resource_missing') createNew = true;
        else throw err;
      }
    } else {
      createNew = true;
    }

    if (createNew) {
      // fetch hotel details for billing info
      const { data: hotelData, error: hotelErr } = await supabase
        .from('hotels')
        .select('name,address,city,state,zip_code,phone_number')
        .eq('id', profile.hotel_id)
        .single();
      if (hotelErr) throw hotelErr;

      // create a new Stripe customer with injected profile
      const customer = await stripe.customers.create({
        name: hotelData.name,
        phone: hotelData.phone_number,
        address: {
          line1: hotelData.address,
          city: hotelData.city,
          state: hotelData.state,
          postal_code: hotelData.zip_code,
          country: 'US'
        },
        metadata: { userId }
      });
      customerId = customer.id;

      // persist new customerId back to Supabase
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId);
      if (updErr) throw updErr;
    }

    res.json({ customerId });
  } catch (err) {
    console.error('get-or-create-customer:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2) create-setup-intent
router.post('/create-setup-intent', async (req, res) => {
  try {
    const { customerId } = req.body;
    if (!customerId) return res.status(400).json({ error: 'Missing customerId' });

    const intent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
    });

    res.json({ clientSecret: intent.client_secret });
  } catch (err) {
    console.error('create-setup-intent:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3) list-payment-methods
router.get('/list-payment-methods/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    if (!customerId) return res.status(400).json({ error: 'Missing customerId' });

    const methods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });

    res.json({ paymentMethods: methods.data });
  } catch (err) {
    console.error('list-payment-methods:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4) set-default-payment-method
router.post('/set-default-payment-method', async (req, res) => {
  try {
    const { userId, paymentMethodId } = req.body;
    if (!userId || !paymentMethodId) {
      return res.status(400).json({ error: 'Missing userId or paymentMethodId' });
    }

    const { error } = await supabase
      .from('profiles')
      .update({ default_payment_method_id: paymentMethodId })
      .eq('id', userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('set-default-payment-method:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
