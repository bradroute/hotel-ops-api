// src/services/telnyxService.js

import { telnyxApiKey, telnyxNumber, telnyxMessagingProfileId } from '../config/index.js';

export async function sendConfirmationSms(destinationNumber) {
  const toNumber =
    typeof destinationNumber === 'string'
      ? destinationNumber
      : destinationNumber?.phone_number || String(destinationNumber);

  console.log('📨 telnyxService: sending from', telnyxNumber, 'to', toNumber);

  const smsPayload = {
    from: telnyxNumber,
    to: toNumber,
    text: 'Hi! Your request has been received and is being taken care of. - Hotel Crosby',
    messaging_profile_id: telnyxMessagingProfileId,
    // channel: 'sms', // usually defaults to sms
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
    console.error('❌ telnyxService: error response:', data);
    const err = new Error('Telnyx send failed');
    err.payload = data;
    throw err;
  }

  console.log('📨 telnyxService: Telnyx response:', data);
  return data;
}
