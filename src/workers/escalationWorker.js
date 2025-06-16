import 'dotenv/config';
import { supabase } from '../services/supabaseService.js';
import { sendSms } from '../services/smsGateway.js';

const ESCALATION_THRESHOLD_MINUTES = 3;
const MANAGER_PHONE = process.env.MANAGER_PHONE;

async function checkUnacknowledgedUrgentRequests() {
  console.log('🔍 Checking for unacknowledged URGENT requests...');
  const cutoff = new Date(Date.now() - ESCALATION_THRESHOLD_MINUTES * 60000).toISOString();

  const { data: reqs, error } = await supabase
    .from('requests')
    .select('*')
    .eq('priority', 'urgent')
    .is('acknowledged_at', null)
    .lte('created_at', cutoff);

  if (error) {
    console.error('❌ Error fetching urgent requests:', error);
    return;
  }

  for (const r of reqs) {
    console.log(`🚨 Found URGENT request ${r.id} older than ${ESCALATION_THRESHOLD_MINUTES}m`);
    await sendSms(MANAGER_PHONE, `ESCALATION: Urgent request (ID ${r.id}) is still unacknowledged.`, 'Escalation');
  }

  console.log('✅ Escalation check complete.');
}

export function start() {
  checkUnacknowledgedUrgentRequests();
  setInterval(checkUnacknowledgedUrgentRequests, 5 * 60 * 1000);  // Still runs every 5 min
}
