// src/services/telnyxService.js

import fetch from 'node-fetch';
import { telnyxApiKey, telnyxNumber, telnyxMessagingProfileId } from '../config/index.js';

/**
 * Send the standard confirmation message back to a guest.
 */
export async function sendConfirmationSms(destinationNumber) {
  const toNumber = typeof destinationNumber === 'string'
    ? destinationNumber
    : destinationNumber?.phone_number;

  console.log('📨 telnyxService: sending confirmation from', telnyxNumber, 'to', toNumber);

  const smsPayload = {
    from: telnyxNumber,
    to: toNumber,
    text: 'Hi! Your request has been received and is being taken care of. - Hotel Crosby',
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
    console.error('❌ telnyxService: confirmation SMS error:', data);
    throw Object.assign(new Error('Telnyx send failed'), { payload: data });
  }

  console.log('📨 telnyxService: confirmation SMS sent:', data);
  return data;
}

/**
 * Send a rejection/“please activate” message to unauthorized numbers.
 */
export async function sendRejectionSms(destinationNumber, text) {
  const toNumber = typeof destinationNumber === 'string'
    ? destinationNumber
    : destinationNumber?.phone_number;

  console.log('📨 telnyxService: sending rejection from', telnyxNumber, 'to', toNumber);

  const smsPayload = {
    from: telnyxNumber,
    to: toNumber,
    text,
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
    console.error('❌ telnyxService: rejection SMS error:', data);
    throw Object.assign(new Error('Telnyx send failed'), { payload: data });
  }

  console.log('📨 telnyxService: rejection SMS sent:', data);
  return data;
}
