import 'dotenv/config';
import { supabase } from '../services/supabaseService.js';
import { sendSms } from '../services/smsGateway.js';
import logger from '../lib/logger.js';

const REMINDER_THRESHOLD_MINUTES = 6;
const MANAGER_PHONE = process.env.MANAGER_PHONE;

async function checkUnacknowledgedRequests() {
  logger.info('Checking for unacknowledged requests...');
  const cutoff = new Date(Date.now() - REMINDER_THRESHOLD_MINUTES * 60000).toISOString();

  const { data: reqs, error } = await supabase
    .from('requests')
    .select('*')
    .is('acknowledged_at', null)
    .lte('created_at', cutoff);

  if (error) {
    logger.error({ err: error }, 'Error fetching requests');
    return;
  }

  for (const r of reqs) {
    logger.warn({ requestId: r.id, thresholdMinutes: REMINDER_THRESHOLD_MINUTES }, 'Found unacknowledged request');
    await sendSms(MANAGER_PHONE, `Reminder: You have a request (ID ${r.id}) waiting for acknowledgment.`, 'Reminder');
  }

  logger.info('Reminder check complete');
}

export function start() {
  checkUnacknowledgedRequests();
  setInterval(checkUnacknowledgedRequests, 5 * 60 * 1000);  // Still runs every 5 min
}
