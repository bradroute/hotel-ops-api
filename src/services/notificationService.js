// src/services/notificationService.js
import { Expo } from 'expo-server-sdk';
import { supabaseAdmin } from './supabaseService.js';
import { sendConfirmationSms } from './telnyxService.js';

const expo = new Expo(); // or new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN })

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

  // Build messages (Expo recommends chunks of ~100)
  const messages = cleaned.map((to) => ({
    to,
    sound: 'default',
    priority: 'high',
    ttl: 300,
    ...payload, // { title, body, data, categoryId? }
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

// Guests register via /app/push/register -> app_push_tokens
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

/* -------------------- public API -------------------- */

/** STAFF: push when a new request is created */
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
      // If you’ve registered this category on the client for action buttons:
      categoryId: 'REQUEST_CATEGORY',
    });
  } catch (e) {
    console.error('[push] notifyStaffOnNewRequest failed:', e);
  }
}

/**
 * GUEST: status updates with single-channel delivery determined by request.source
 *  - 'app_guest' → push only (no SMS fallback, even if missing tokens)
 *  - 'sms'       → SMS only
 *  - others      → skip (no guest notification)
 */
export async function notifyGuestOnStatus(requestRow, status /* 'acknowledged' | 'completed' */) {
  try {
    const source = String(requestRow.source || '').toLowerCase();
    const appAccountId = requestRow.app_account_id ?? requestRow.appAccountId ?? null;
    const phone = requestRow.from_phone ?? requestRow.phone ?? null;

    const smsAck = 'Operon: Your request has been received and is being worked on.';
    const smsDone = 'Operon: Your request has been completed.';
    const pushTitle = status === 'acknowledged' ? 'We’re on it' : 'Completed';
    const pushBody  = status === 'acknowledged' ? smsAck : smsDone;

    if (source === 'app_guest') {
      // Push only
      const tokens = await guestTokens(appAccountId);
      if (!tokens.length) {
        console.log('[notifyGuestOnStatus] app_guest but no push tokens; skipping SMS by policy');
        return;
      }
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
      // SMS only
      if (!phone) {
        console.log('[notifyGuestOnStatus] sms request but missing phone; cannot send SMS');
        return;
      }
      await sendConfirmationSms(phone, status === 'acknowledged' ? smsAck : smsDone);
      return;
    }

    // app_staff or anything else → no guest notification
    console.log('[notifyGuestOnStatus] unsupported/guestless source:', source, '→ skipping');
  } catch (e) {
    console.error('[push] notifyGuestOnStatus failed:', e);
  }
}
