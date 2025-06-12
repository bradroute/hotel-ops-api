require('dotenv').config();
const { supabase } = require('../services/supabaseService');
const { sendSms } = require('../services/smsGateway');

const REMINDER_THRESHOLD_MINUTES = 15;
const MANAGER_PHONE = process.env.MANAGER_PHONE || '+11234567890';

async function sendReminder(to, requestId) {
  const message = `Reminder: You have a request (ID ${requestId}) waiting for acknowledgment.`;
  await sendSms(to, message, 'Reminder');
}

async function checkUnacknowledgedRequests() {
  console.log('🔍 Checking for unacknowledged requests...');
  const thresholdDate = new Date(Date.now() - REMINDER_THRESHOLD_MINUTES * 60 * 1000).toISOString();

  const { data: requests, error } = await supabase
    .from('requests')
    .select('*')
    .is('acknowledged_at', null)
    .lte('created_at', thresholdDate);

  if (error) {
    console.error('❌ Error fetching requests:', error);
    return;
  }

  for (const request of requests) {
    console.log(`📣 Found unacknowledged request ID ${request.id} older than ${REMINDER_THRESHOLD_MINUTES} min`);
    await sendReminder(MANAGER_PHONE, request.id);
  }

  console.log('✅ Reminder check complete.');
}

function start() {
  checkUnacknowledgedRequests();
  setInterval(checkUnacknowledgedRequests, 5 * 60 * 1000);
}

module.exports = { start };
