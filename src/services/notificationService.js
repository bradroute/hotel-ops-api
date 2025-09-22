// src/services/notificationService.js
import { Expo } from 'expo-server-sdk';
import { supabaseAdmin } from './supabaseService.js';
import { sendConfirmationSms } from './telnyxService.js';
import { telnyxNumber as DEFAULT_TELNYX_DID } from '../config/index.js';

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
    console.log('[push] no valid Expo tokens to send');
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
      console.log('[push] expo ticket chunk:', JSON.stringify(ticketChunk).slice(0, 400));
    } catch (e) {
      console.error('[push] expo chunk failed:', e);
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
    console.error('[push] staff token query error:', error);
    return [];
  }
  const tokens = uniqStrings((data || []).map((r) => r.expo_push_token));
  console.log('[push] staff tokens fetched:', tokens.length, 'for hotel', hotel_id);
  return tokens;
}

async function guestTokens(app_account_id) {
  if (!app_account_id) return [];
  const { data, error } = await supabaseAdmin
    .from('app_push_tokens')
    .select('expo_token')
    .eq('app_account_id', app_account_id);
  if (error) {
    console.error('[push] guest token query error:', error);
    return [];
  }
  const tokens = uniqStrings((data || []).map((r) => r.expo_token));
  console.log('[push] guest tokens fetched:', tokens.length, 'for app_account', app_account_id);
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
      console.log('[notify] DID via telnyx_numbers:', tn[0].phone_number);
      return tn[0].phone_number;
    }
    if (tnErr) console.warn('[notify] telnyx_numbers lookup error:', tnErr);

    // 2) fallback → hotels.phone_number
    const { data: hotel, error: hErr } = await supabaseAdmin
      .from('hotels')
      .select('phone_number,name')
      .eq('id', hotel_id)
      .maybeSingle();
    if (!hErr && hotel?.phone_number) {
      console.log('[notify] DID via hotels.phone_number:', hotel.phone_number, 'name:', hotel?.name);
      return hotel.phone_number;
    }
    if (hErr) console.warn('[notify] hotels fallback error:', hErr);
  } catch (e) {
    console.warn('[notify] DID resolve unexpected error:', e?.message || e);
  }

  // 3) final fallback → config
  if (DEFAULT_TELNYX_DID) {
    console.log('[notify] DID via config fallback:', DEFAULT_TELNYX_DID);
    return DEFAULT_TELNYX_DID;
  }

  console.warn('[notify] DID resolve: no suitable number found');
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
    console.error('[push] notifyStaffOnNewRequest failed:', e);
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
      console.log('[push] sending', status, 'push to', tokens.length, 'token(s)');
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
        console.warn('[notify] sms source but missing guest phone; skipping');
        return;
      }
      const fromDid = await getHotelDid(requestRow.hotel_id);
      console.log('[notify] sending', status, 'SMS to', phone, 'from', fromDid || '[default]');
      // telnyxService adds the compliance footer
      await sendConfirmationSms(
        phone,
        status === 'acknowledged' ? smsAck : smsDone,
        fromDid ? { from: fromDid } : undefined
      );
      return;
    }

    // other sources → no guest notification
    console.log('[notify] no guest notification for source:', source);
  } catch (e) {
    console.error('[notify] notifyGuestOnStatus failed:', e);
  }
}

/* convenience wrappers for requestActions.js */
export const notifyGuestOnAcknowledged = (row) => notifyGuestOnStatus(row, 'acknowledged');
export const notifyGuestOnCompleted = (row) => notifyGuestOnStatus(row, 'completed');
