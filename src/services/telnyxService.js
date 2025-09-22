// src/services/telnyxService.js
import {
  telnyxApiKey,
  telnyxNumber,               // fallback DID in E.164 (+1…)
  telnyxMessagingProfileId,
  apiBaseUrl,                 // e.g. https://hotel-ops-api-1.onrender.com
} from '../config/index.js';

const COMPLIANCE_FOOTER = ' Reply HELP for assistance or STOP to unsubscribe.';
const MAX_LEN = 800; // keep SMS bodies sane

const e164 = (n) => (n ? String(n).replace(/[^\d+]/g, '') : '');
function assertPhone(n, label) {
  const v = e164(n);
  if (!v || !v.startsWith('+')) throw new Error(`${label} missing/invalid E.164`);
  return v;
}

/**
 * Low-level sender used by helpers.
 * If apiBaseUrl is set, delivery receipts go to `${apiBaseUrl}/sms-status`.
 */
async function sendSmsRaw({ to, text, from }) {
  const toE164 = assertPhone(to, 'to');
  const fromE164 = assertPhone(from || telnyxNumber, 'from');
  const bodyText = String(text ?? '').trim().slice(0, MAX_LEN);
  if (!bodyText) throw new Error('text body missing');

  const payload = {
    from: fromE164,
    to: toE164,
    text: bodyText,
    messaging_profile_id: telnyxMessagingProfileId,
    ...(apiBaseUrl
      ? { webhook_url: `${apiBaseUrl.replace(/\/+$/, '')}/sms-status` }
      : {}),
  };

  const res = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${telnyxApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }

  if (!res.ok) {
    console.error('❌ Telnyx send error', { status: res.status, data });
    const err = new Error('Telnyx send failed');
    err.payload = data;
    throw err;
  }
  return data;
}

/**
 * Confirmation / acknowledgement
 * @param {string|{phone_number:string}} destinationNumber
 * @param {string} text - body before compliance footer
 * @param {{from?: string}} [opts]
 */
export async function sendConfirmationSms(destinationNumber, text, opts = {}) {
  const to =
    typeof destinationNumber === 'string'
      ? destinationNumber
      : destinationNumber?.phone_number;

  const payload = `${String(text ?? '').trim()}${COMPLIANCE_FOOTER}`;
  const resp = await sendSmsRaw({ to, text: payload, from: opts.from });
  console.log('✅ Confirmation SMS sent:', resp?.data?.id || resp?.id || '');
  return resp;
}

/**
 * Rejection / activation required
 * @param {string|{phone_number:string}} destinationNumber
 * @param {string} text
 * @param {{from?: string}} [opts]
 */
export async function sendRejectionSms(destinationNumber, text, opts = {}) {
  const to =
    typeof destinationNumber === 'string'
      ? destinationNumber
      : destinationNumber?.phone_number;

  const payload = `${String(text ?? '').trim()}${COMPLIANCE_FOOTER}`;
  const resp = await sendSmsRaw({ to, text: payload, from: opts.from });
  console.log('✅ Rejection SMS sent:', resp?.data?.id || resp?.id || '');
  return resp;
}
