// src/services/telnyxService.js

// NOTE: No `require('node-fetch')`—we'll use Node 18+'s built-in fetch instead
// If your Node version is older than v18, update to at least v18 or install "node-fetch@2".

const { telnyxApiKey, telnyxNumber } = require('../config');

/**
 * Send a confirmation SMS via Telnyx.
 * @param {string} destinationNumber E.164‐formatted phone number (e.g. "+16513459559")
 * @returns {object} Telnyx API JSON response
 */
async function sendConfirmationSms(destinationNumber) {
  const smsPayload = {
    from: telnyxNumber,
    to: destinationNumber,
    text: 'Hi! Your request has been received and is being taken care of. - Hotel Crosby',
  };

  // Use Node’s built-in fetch (v18+). No need to import node-fetch.
  const response = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${telnyxApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(smsPayload),
  });

  const data = await response.json();
  if (!response.ok) {
    const err = new Error('Telnyx send failed');
    err.payload = data;
    throw err;
  }
  return data;
}

module.exports = {
  sendConfirmationSms,
};
