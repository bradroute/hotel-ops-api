// routes/stripe.js or your equivalent file
import express from 'express';
import Stripe from 'stripe';

const router = express.Router();

// Use your test secret key here
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post('/create-customer-portal-session', async (req, res) => {
  const { stripeCustomerId } = req.body;

  if (!stripeCustomerId) {
    return res.status(400).json({ error: 'Missing stripeCustomerId' });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: 'http://localhost:3000/settings', // Adjust to your frontend
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe portal error:', error);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

export default router;
