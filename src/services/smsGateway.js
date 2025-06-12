require('dotenv').config();
const { sendTelnyxSms } = require('./telnyxService');

const DRY_RUN = process.env.SEND_SMS !== 'true';  // default to dry-run unless explicitly true

async function sendSms(to, message, context = 'General') {
  if (DRY_RUN) {
    console.log(`[DRY RUN SMS] (${context}) To: ${to} | Message: "${message}"`);
    return;
  }

  try {
    const result = await sendTelnyxSms(to, message);
    console.log(`[REAL SMS SENT] (${context}) To: ${to} | Telnyx result:`, result);
    return result;
  } catch (err) {
    console.error(`[SMS FAILURE] (${context}) To: ${to} | Error:`, err);
  }
}

module.exports = { sendSms };
