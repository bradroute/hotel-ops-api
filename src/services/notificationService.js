// src/services/notificationService.js
import { Expo } from 'expo-server-sdk';
import { supabaseAdmin } from './supabaseService.js';
import { sendConfirmationSms } from './telnyxService.js';

const expo = new Expo();

/* -------------------- in-memory de-dupe (5s window) -------------------- */
const recentNotifies = new Map(); // key: `${request_id}:${status}` -> timestamp(ms)
function shouldSkipNotify(key, windowMs = 5000) {
  const now = Date.now();
  const last = recentNotifies.get(key) || 0;
  if (now - last < windowMs) return true;
  recentNotifies.set(key, now);
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
  const messages = cleaned.map((to) => ({ to, sound: 'default', priority: 'high', ttl: 300, ...payload }));
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
  if (error) { console.error('[push] staff token query error:', error); return []; }
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
  if (error) { console.error('[push] guest token query error:', error); return []; }
  const tokens = uniqStrings((data || []).map((r) => r.expo_token));
  console.log('[push] guest tokens fetched:', tokens.length, 'for app_account', app_account_id);
  return tokens;
}

async function getHotelDid(hotel_id) {
  if (!hotel_id) return undefined;
  const { data, error } = await supabaseAdmin
    .from('hotels')
    .select('sms_did, phone_number')
    .eq('id', hotel_id)
    .maybeSingle();
  if (error) { console.error('[notify] hotel DID lookup error:', error); return undefined; }
  // Prefer sms_did, fallback to phone_number
  return data?.sms_did || data?.phone_number || undefined;
}

/* -------------------- public API -------------------- */

export async function notifyStaffOnNewRequest(requestRow) {
  try {
    const tokens = await staffTokens(requestRow.hotel_id);
    if (!tokens.length) return;
    await sendPush(tokens, {
      title: `New ${requestRow.department || 'Service'} Request`,
      body: requestRow.message?.slice(0, 140) || 'Open to view details.',
      data: { t: 'new_request', screen: 'RequestDetail', request_id: requestRow.id, hotel_id: requestRow.hotel_id },
      categoryId: 'REQUEST_CATEGORY',
    });
  } catch (e) {
    console.error('[push] notifyStaffOnNewRequest failed:', e);
  }
}

/**
 * GUEST: status updates (single-channel)
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
    const pushBody  = status === 'acknowledged' ? smsAck : smsDone;

    if (source === 'app_guest') {
      const tokens = await guestTokens(appAccountId);
      if (!tokens.length) return;
      await sendPush(tokens, {
        title: pushTitle,
        body: pushBody,
        data: { t: status, screen: 'RequestDetail', request_id: requestRow.id, hotel_id: requestRow.hotel_id },
      });
      return;
    }

    if (source === 'sms') {
      if (!phone) return;
      const fromDid = await getHotelDid(requestRow.hotel_id);
      await sendConfirmationSms(phone, status === 'acknowledged' ? smsAck : smsDone, { from: fromDid });
      return;
    }

    // other sources → no guest notification
  } catch (e) {
    console.error('[push] notifyGuestOnStatus failed:', e);
  }
}
