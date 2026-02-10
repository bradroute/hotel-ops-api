import 'dotenv/config';
import { supabase } from '../services/supabaseService.js';
import { sendSms } from '../services/smsGateway.js';
import logger from '../lib/logger.js';

const ESCALATION_THRESHOLD_MINUTES = 3;
const MANAGER_PHONE = process.env.MANAGER_PHONE;

async function checkUnacknowledgedUrgentRequests() {
  logger.info('Checking for unacknowledged URGENT requests...');
  const cutoff = new Date(Date.now() - ESCALATION_THRESHOLD_MINUTES * 60000).toISOString();

  const { data: reqs, error } = await supabase
    .from('requests')
    .select('*')
    .eq('priority', 'urgent')
    .is('acknowledged_at', null)
    .lte('created_at', cutoff);

  if (error) {
    logger.error({ err: error }, 'Error fetching urgent requests');
    return;
  }

  for (const r of reqs) {
    logger.warn({ requestId: r.id, thresholdMinutes: ESCALATION_THRESHOLD_MINUTES }, 'Found unacknowledged URGENT request');
    await sendSms(MANAGER_PHONE, `ESCALATION: Urgent request (ID ${r.id}) is still unacknowledged.`, 'Escalation');
  }

  logger.info('Escalation check complete');
}

export function start() {
  checkUnacknowledgedUrgentRequests();
  setInterval(checkUnacknowledgedUrgentRequests, 5 * 60 * 1000);  // Still runs every 5 min
}
