import 'dotenv/config';
import { supabase } from '../services/supabaseService.js';
import { sendSms } from '../services/smsGateway.js';

const REMINDER_THRESHOLD_MINUTES = 15;
const MANAGER_PHONE = process.env.MANAGER_PHONE;

async function checkUnacknowledgedRequests() {
  console.log('🔍 Checking for unacknowledged requests...');
  const cutoff = new Date(Date.now() - REMINDER_THRESHOLD_MINUTES * 60000).toISOString();

  const { data: reqs, error } = await supabase
    .from('requests')
    .select('*')
    .is('acknowledged_at', null)
    .lte('created_at', cutoff);

  if (error) {
    console.error('❌ Error fetching requests:', error);
    return;
  }

  for (const r of reqs) {
    console.log(`📣 Found request ${r.id} older than ${REMINDER_THRESHOLD_MINUTES}m`);
    await sendSms(MANAGER_PHONE, `Reminder: You have a request (ID ${r.id}) waiting for acknowledgment.`, 'Reminder');
  }

  console.log('✅ Reminder check complete.');
}

export function start() {
  checkUnacknowledgedRequests();
  setInterval(checkUnacknowledgedRequests, 5 * 60 * 1000);
}
