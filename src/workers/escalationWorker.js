require('dotenv').config();
const { supabase } = require('../services/supabaseService');
const { sendSms } = require('../services/smsGateway');

const ESCALATION_THRESHOLD_MINUTES = 10;
const MANAGER_PHONE = process.env.MANAGER_PHONE || '+11234567890';

async function sendEscalation(to, requestId) {
  const message = `ESCALATION: Urgent request (ID ${requestId}) is still unacknowledged.`;
  await sendSms(to, message, 'Escalation');
}

async function checkUnacknowledgedUrgentRequests() {
  console.log('🔍 Checking for unacknowledged URGENT requests...');
  const thresholdDate = new Date(Date.now() - ESCALATION_THRESHOLD_MINUTES * 60 * 1000).toISOString();

  const { data: requests, error } = await supabase
    .from('requests')
    .select('*')
    .eq('priority', 'urgent')
    .is('acknowledged_at', null)
    .lte('created_at', thresholdDate);

  if (error) {
    console.error('❌ Error fetching urgent requests:', error);
    return;
  }

  for (const request of requests) {
    console.log(`🚨 Found unacknowledged URGENT request ID ${request.id} older than ${ESCALATION_THRESHOLD_MINUTES} min`);
    await sendEscalation(MANAGER_PHONE, request.id);
  }

  console.log('✅ Escalation check complete.');
}

function start() {
  checkUnacknowledgedUrgentRequests();
  setInterval(checkUnacknowledgedUrgentRequests, 5 * 60 * 1000);
}

module.exports = { start };
