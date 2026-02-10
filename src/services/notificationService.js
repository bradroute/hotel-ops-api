// src/services/notificationService.js
import { Expo } from 'expo-server-sdk';
import { supabaseAdmin } from './supabaseService.js';
import { sendConfirmationSms } from './telnyxService.js';
import { telnyxNumber as DEFAULT_TELNYX_DID } from '../config/index.js';
import logger from '../lib/logger.js';

const expo = new Expo();

/* -------------------- in-memory de-dupe (5s window) -------------------- */
const recentNotifies = new Map(); // key: `${request_id}:${status}` -> timestamp(ms)
function shouldSkipNotify(key, windowMs = 5000) {
  const now = Date.now();
  const last = recentNotifies.get(key) || 0;
  if (now - last < windowMs) return true;
  recentNotifies.set(key, now);
  // light GC
  for (const [k, t] of recentNotifies) if (now - t > windowMs * 10) recentNotifies.delete(k);
  return false;
}

/* -------------------- helpers -------------------- */

function uniqStrings(arr = []) {
  return [...new Set((arr || []).filter(Boolean).map(String))];
}

async function sendPush(tokens = [], payload) {
  const cleaned = uniqStrings(tokens).filter((t) => Expo.isExpoPushToken(t));
  if (!cleaned.length) {
    logger.info('no valid Expo tokens to send');
    return [];
  }
  const messages = cleaned.map((to) => ({
    to,
    sound: 'default',
    priority: 'high',
    ttl: 300,
    ...payload,
  }));
  const tickets = [];
  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
      logger.info({ tickets: JSON.stringify(ticketChunk).slice(0, 400) }, 'expo ticket chunk');
    } catch (e) {
      logger.error({ err: e }, 'expo chunk failed');
    }
  }
  return tickets;
}

async function staffTokens(hotel_id) {
  if (!hotel_id) return [];
  const { data, error } = await supabaseAdmin
    .from('staff_devices')
    .select('expo_push_token')
    .eq('hotel_id', hotel_id);
  if (error) {
    logger.error({ err: error }, 'staff token query error');
    return [];
  }
  const tokens = uniqStrings((data || []).map((r) => r.expo_push_token));
  logger.info({ count: tokens.length, hotel_id }, 'staff tokens fetched');
  return tokens;
}

async function guestTokens(app_account_id) {
  if (!app_account_id) return [];
  const { data, error } = await supabaseAdmin
    .from('app_push_tokens')
    .select('expo_token')
    .eq('app_account_id', app_account_id);
  if (error) {
    logger.error({ err: error }, 'guest token query error');
    return [];
  }
  const tokens = uniqStrings((data || []).map((r) => r.expo_token));
  logger.info({ count: tokens.length, app_account_id }, 'guest tokens fetched');
  return tokens;
}

/**
 * Resolve the SMS "from" DID for a hotel.
 * Priority:
 *   1) telnyx_numbers.phone_number (by hotel_id)
 *   2) hotels.phone_number (fallback)
 *   3) DEFAULT_TELNYX_DID from config (final fallback)
 */
async function getHotelDid(hotel_id) {
  if (!hotel_id) return DEFAULT_TELNYX_DID;

  try {
    // 1) telnyx_numbers → first number for this hotel
    const { data: tn, error: tnErr } = await supabaseAdmin
      .from('telnyx_numbers')
      .select('phone_number')
      .eq('hotel_id', hotel_id)
      .limit(1);
    if (!tnErr && tn?.length && tn[0]?.phone_number) {
      logger.info({ did: tn[0].phone_number }, 'DID via telnyx_numbers');
      return tn[0].phone_number;
    }
    if (tnErr) logger.warn({ err: tnErr }, 'telnyx_numbers lookup error');

    // 2) fallback → hotels.phone_number
    const { data: hotel, error: hErr } = await supabaseAdmin
      .from('hotels')
      .select('phone_number,name')
      .eq('id', hotel_id)
      .maybeSingle();
    if (!hErr && hotel?.phone_number) {
      logger.info({ did: hotel.phone_number, name: hotel?.name }, 'DID via hotels.phone_number');
      return hotel.phone_number;
    }
    if (hErr) logger.warn({ err: hErr }, 'hotels fallback error');
  } catch (e) {
    logger.warn({ err: e }, 'DID resolve unexpected error');
  }

  // 3) final fallback → config
  if (DEFAULT_TELNYX_DID) {
    logger.info({ did: DEFAULT_TELNYX_DID }, 'DID via config fallback');
    return DEFAULT_TELNYX_DID;
  }

  logger.warn('DID resolve: no suitable number found');
  return undefined;
}

/* -------------------- public API -------------------- */

export async function notifyStaffOnNewRequest(requestRow) {
  try {
    const tokens = await staffTokens(requestRow.hotel_id);
    if (!tokens.length) return;
    await sendPush(tokens, {
      title: `New ${requestRow.department || 'Service'} Request`,
      body: requestRow.message?.slice(0, 140) || 'Open to view details.',
      data: {
        t: 'new_request',
        screen: 'RequestDetail',
        request_id: requestRow.id,
        hotel_id: requestRow.hotel_id,
      },
      categoryId: 'REQUEST_CATEGORY',
    });
  } catch (e) {
    logger.error({ err: e }, 'notifyStaffOnNewRequest failed');
  }
}

/**
 * GUEST status updates (single-channel)
 *  - 'app_guest' → push only
 *  - 'sms'       → SMS only (sent from hotel’s DID)
 */
export async function notifyGuestOnStatus(requestRow, status /* 'acknowledged' | 'completed' */) {
  try {
    const key = `${requestRow.id}:${status}`;
    if (shouldSkipNotify(key)) return;

    const source = String(requestRow.source || '').toLowerCase();
    const appAccountId = requestRow.app_account_id ?? requestRow.appAccountId ?? null;
    const phone = requestRow.from_phone ?? requestRow.phone ?? null;

    const smsAck = 'Operon: Your request has been received and is being worked on.';
    const smsDone = 'Operon: Your request has been completed.';
    const pushTitle = status === 'acknowledged' ? 'We’re on it' : 'Completed';
    const pushBody = status === 'acknowledged' ? smsAck : smsDone;

    if (source === 'app_guest') {
      const tokens = await guestTokens(appAccountId);
      if (!tokens.length) return;
      logger.info({ status, tokenCount: tokens.length }, 'sending push notification');
      await sendPush(tokens, {
        title: pushTitle,
        body: pushBody,
        data: {
          t: status,
          screen: 'RequestDetail',
          request_id: requestRow.id,
          hotel_id: requestRow.hotel_id,
        },
      });
      return;
    }

    if (source === 'sms') {
      if (!phone) {
        logger.warn('sms source but missing guest phone; skipping');
        return;
      }
      const fromDid = await getHotelDid(requestRow.hotel_id);
      logger.info({ status, to: phone, from: fromDid || '[default]' }, 'sending status SMS');
      // telnyxService adds the compliance footer
      await sendConfirmationSms(
        phone,
        status === 'acknowledged' ? smsAck : smsDone,
        fromDid ? { from: fromDid } : undefined
      );
      return;
    }

    // other sources → no guest notification
    logger.info({ source }, 'no guest notification for source');
  } catch (e) {
    logger.error({ err: e }, 'notifyGuestOnStatus failed');
  }
}

/* convenience wrappers for requestActions.js */
export const notifyGuestOnAcknowledged = (row) => notifyGuestOnStatus(row, 'acknowledged');
export const notifyGuestOnCompleted = (row) => notifyGuestOnStatus(row, 'completed');
