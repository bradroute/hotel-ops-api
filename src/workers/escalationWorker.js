import 'dotenv/config';
import { supabase } from '../services/supabaseService.js';
import { sendSms }  from '../services/smsGateway.js';

const ESCALATION_THRESHOLD_MINUTES = 10;
const MANAGER_PHONE = process.env.MANAGER_PHONE || '+11234567890';

async function sendEscalation(to, requestId) {
  const message = `ESCALATION: Urgent request (ID ${requestId}) is still unacknowledged.`;
  await sendSms(to, message, 'Escalation');
}

async function checkUnacknowledgedUrgentRequests() {
  console.log('🔍 Checking for unacknowledged URGENT requests...');
  const cutoff = new Date(Date.now() - ESCALATION_THRESHOLD_MINUTES * 60 * 1000).toISOString();

  const { data: requests, error } = await supabase
    .from('requests')
    .select('*')
    .eq('priority', 'urgent')
    .is('acknowledged_at', null)
    .lte('created_at', cutoff);

  if (error) {
    console.error('❌ Error fetching urgent requests:', error);
    return;
  }

  for (const req of requests) {
    console.log(`🚨 Found unacknowledged URGENT request ID ${req.id} older than ${ESCALATION_THRESHOLD_MINUTES} min`);
    await sendEscalation(MANAGER_PHONE, req.id);
  }

  console.log('✅ Escalation check complete.');
}

export function start() {
  checkUnacknowledgedUrgentRequests();
  setInterval(checkUnacknowledgedUrgentRequests, 5 * 60 * 1000);
}
