// src/services/smsGateway.js
import { sendConfirmationSms } from './telnyxService.js';
import logger from '../lib/logger.js';

const DRY_RUN = process.env.SEND_SMS !== 'true';
const MAX_LEN = 500; // keep bodies sane; carriers segment long SMS

const toE164 = (v = '') => {
  const d = String(v).replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('1') ? `+${d}` : `+1${d}`;
};

/**
 * Thin SMS wrapper. Uses Telnyx confirm-style sender with compliance footer.
 * @param {string} to E.164 number (e.g., +15551234567)
 * @param {string} message Body text (pre-footer)
 * @param {string} context Log label
 */
export async function sendSms(to, message, context = 'General') {
  const toNorm = toE164(to);
  const body = String(message ?? '').trim().slice(0, MAX_LEN);

  if (!toNorm || !body) {
    logger.warn({ to }, 'missing/invalid to or message; skip send');
    return;
  }

  if (DRY_RUN) {
    logger.info({ context, to: toNorm, body }, 'DRY RUN SMS');
    return { dryRun: true };
  }

  try {
    const result = await sendConfirmationSms(toNorm, body);
    logger.info({ context, to: toNorm, messageId: result?.data?.id || result?.id }, 'SMS sent');
    return result;
  } catch (err) {
    logger.error({ err, context, to: toNorm }, 'SMS send failure');
    throw err;
  }
}
