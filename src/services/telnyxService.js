// src/services/telnyxService.js
import fetch from 'node-fetch';
import {
  telnyxApiKey,
  telnyxNumber,
  telnyxMessagingProfileId
} from '../config/index.js';

const COMPLIANCE_FOOTER = ' Reply HELP for assistance or STOP to unsubscribe.';

/**
 * Send a confirmation-style SMS (opt-in confirmation or acknowledgement).
 * @param {string|object} destinationNumber  Phone number string or object with phone_number.
 * @param {string} text                     The custom message body (before compliance footer).
 */
export async function sendConfirmationSms(destinationNumber, text) {
  const toNumber = typeof destinationNumber === 'string'
    ? destinationNumber
    : destinationNumber?.phone_number;

  console.log('📨 telnyxService: sending confirmation to', toNumber);
  console.log('    • body:', text);

  const smsPayload = {
    from: telnyxNumber,
    to: toNumber,
    text: `${text}${COMPLIANCE_FOOTER}`,
    messaging_profile_id: telnyxMessagingProfileId,
  };

  const res = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${telnyxApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(smsPayload),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('❌ Confirmation SMS error:', data);
    throw Object.assign(new Error('Telnyx send failed'), { payload: data });
  }

  console.log('✅ Confirmation SMS sent:', data);
  return data;
}

/**
 * Send a rejection/“please activate” SMS with compliance footer.
 * @param {string|object} destinationNumber
 * @param {string} text
 */
export async function sendRejectionSms(destinationNumber, text) {
  const toNumber = typeof destinationNumber === 'string'
    ? destinationNumber
    : destinationNumber?.phone_number;

  console.log('📨 telnyxService: sending rejection to', toNumber);
  console.log('    • body:', text);

  const smsPayload = {
    from: telnyxNumber,
    to: toNumber,
    text: `${text}${COMPLIANCE_FOOTER}`,
    messaging_profile_id: telnyxMessagingProfileId,
  };

  const res = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${telnyxApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(smsPayload),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('❌ Rejection SMS error:', data);
    throw Object.assign(new Error('Telnyx send failed'), { payload: data });
  }

  console.log('✅ Rejection SMS sent:', data);
  return data;
}
