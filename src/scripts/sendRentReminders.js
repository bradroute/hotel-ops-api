// src/scripts/sendRentReminders.js

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { sendConfirmationSms } from '../services/telnyxService.js'; // Correct export!
import { supabaseUrl, supabaseServiceRoleKey } from '../config/index.js';

// Initialize Supabase with Service Role Key for full DB access
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function sendRentReminders() {
  const now = new Date().toISOString();

  // Fetch all active tenants (not staff, not expired)
  const { data: tenants, error } = await supabase
    .from('authorized_numbers')
    .select('phone, room_number, hotel_id')
    .eq('is_staff', false)
    .gt('expires_at', now)
    .limit(1); // <-- REMOVE this .limit(1) after testing!

  if (error) {
    console.error('❌ Failed to fetch tenants:', error);
    return;
  }

  for (const tenant of tenants) {
    const paymentUrl = `https://app.operonplatform.com/pay/${tenant.hotel_id}`;
    const message = `Operon: Your rent is due. Pay now at ${paymentUrl}`;

    try {
      await sendConfirmationSms(tenant.phone, message); // Compliance footer auto-added!
      console.log(`✅ SMS sent to ${tenant.phone}`);
    } catch (err) {
      console.error(`❌ Failed to send to ${tenant.phone}:`, err.message);
    }
  }

  console.log(`🎉 Rent reminders complete: ${tenants.length} total.`);
}

sendRentReminders().catch(console.error);
