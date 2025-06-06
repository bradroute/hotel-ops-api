// src/services/telnyxService.js

// NOTE: No `require('node-fetch')`—we'll use Node 18+'s built-in fetch instead

const { telnyxApiKey, telnyxNumber } = require('../config');

/**
 * Send a confirmation SMS via Telnyx.
 * @param {string|object} destinationNumber E.164‐formatted phone number or object containing phone_number property
 * @returns {object} Telnyx API JSON response
 */
async function sendConfirmationSms(destinationNumber) {
  // Ensure destinationNumber is a string; if it's an object, extract the phone_number property
  const toNumber =
    typeof destinationNumber === 'string'
      ? destinationNumber
      : destinationNumber?.phone_number || String(destinationNumber);

  console.log('📨 telnyxService: sending from', telnyxNumber, 'to', toNumber);

  const smsPayload = {
    from: telnyxNumber,
    to: toNumber,
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
    console.error('❌ telnyxService: error response:', data);
    throw err;
  }

  console.log('📨 telnyxService: Telnyx response:', data);
  return data;
}

module.exports = {
  sendConfirmationSms,
};
