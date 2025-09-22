// src/services/telnyxService.js
import {
  telnyxApiKey,
  telnyxNumber,                 // fallback DID (+E.164)
  telnyxMessagingProfileId,
} from '../config/index.js';

const COMPLIANCE_FOOTER = ' Reply HELP for assistance or STOP to unsubscribe.';

function e164(n) {
  return n ? String(n).replace(/[^\d+]/g, '') : '';
}
function assertPhone(n, label) {
  const v = e164(n);
  if (!v || !v.startsWith('+')) throw new Error(`${label} missing/invalid E.164`);
  return v;
}

async function sendSmsRaw({ to, text, from }) {
  const toE164 = assertPhone(to, 'to');
  const fromE164 = assertPhone(from || telnyxNumber, 'from');

  const body = {
    from: fromE164,
    to: toE164,
    text,
    messaging_profile_id: telnyxMessagingProfileId,
    // No webhook_url required for basic outbound sends
  };

  const res = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${telnyxApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('❌ Telnyx send error', { status: res.status, data });
    const err = new Error('Telnyx send failed');
    err.payload = data;
    throw err;
  }
  return data;
}

/** Confirmation / acknowledgement */
export async function sendConfirmationSms(destinationNumber, text, opts = {}) {
  const to =
    typeof destinationNumber === 'string'
      ? destinationNumber
      : destinationNumber?.phone_number;

  const payload = `${text}${COMPLIANCE_FOOTER}`;
  const resp = await sendSmsRaw({ to, text: payload, from: opts.from });
  console.log('✅ Confirmation SMS sent:', resp?.data?.id || resp);
  return resp;
}

/** Rejection / activation required */
export async function sendRejectionSms(destinationNumber, text, opts = {}) {
  const to =
    typeof destinationNumber === 'string'
      ? destinationNumber
      : destinationNumber?.phone_number;

  const payload = `${text}${COMPLIANCE_FOOTER}`;
  const resp = await sendSmsRaw({ to, text: payload, from: opts.from });
  console.log('✅ Rejection SMS sent:', resp?.data?.id || resp);
  return resp;
}
