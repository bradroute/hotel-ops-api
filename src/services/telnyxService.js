import { telnyxApiKey, telnyxNumber } from '../config.js';

/**
 * Internal function that sends SMS via Telnyx.
 * Used by both main app and worker.
 */
async function sendTelnyxSms(toNumber, text) {
  console.log('📨 telnyxService: sending from', telnyxNumber, 'to', toNumber);

  const smsPayload = {
    from: telnyxNumber,
    to: toNumber,
    text,
  };

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

/**
 * Public function used for confirmation SMS inside app routes.
 */
export async function sendConfirmationSms(destinationNumber) {
  const toNumber =
    typeof destinationNumber === 'string'
      ? destinationNumber
      : destinationNumber?.phone_number || String(destinationNumber);

  const text = 'Hi! Your request has been received and is being taken care of. - Hotel Crosby';
  return sendTelnyxSms(toNumber, text);
}

// Export for worker code
export { sendTelnyxSms };

