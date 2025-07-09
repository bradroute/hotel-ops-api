// src/services/telnyxService.js
import fetch from 'node-fetch';
import {
  telnyxApiKey,
  telnyxNumber,
  telnyxMessagingProfileId
} from '../config/index.js';

const COMPLIANCE_FOOTER = ' Reply HELP for assistance or STOP to unsubscribe.';

/**
 * Send any confirmation-style SMS (opt-in or acknowledge).
 * The `text` arg should be your custom message body.
 */
export async function sendConfirmationSms(destinationNumber, text) {
  const toNumber = typeof destinationNumber === 'string'
    ? destinationNumber
    : destinationNumber?.phone_number;

  console.log('📨 Sending confirmation SMS to', toNumber);

  const smsPayload = {
    from: telnyxNumber,
    to: toNumber,
    text: `${text}${COMPLIANCE_FOOTER}`,
    messaging_profile_id: telnyxMessagingProfileId,
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
    console.error('❌ Confirmation SMS error:', data);
    throw Object.assign(new Error('Telnyx send failed'), { payload: data });
  }
  console.log('✅ Confirmation SMS sent:', data);
  return data;
}

/**
 * Send a rejection/“please activate” SMS.
 */
export async function sendRejectionSms(destinationNumber, text) {
  const toNumber = typeof destinationNumber === 'string'
    ? destinationNumber
    : destinationNumber?.phone_number;

  console.log('📨 Sending rejection SMS to', toNumber);

  const smsPayload = {
    from: telnyxNumber,
    to: toNumber,
    text: `${text}${COMPLIANCE_FOOTER}`,
    messaging_profile_id: telnyxMessagingProfileId,
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
    console.error('❌ Rejection SMS error:', data);
    throw Object.assign(new Error('Telnyx send failed'), { payload: data });
  }
  console.log('✅ Rejection SMS sent:', data);
  return data;
}
