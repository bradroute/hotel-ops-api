// src/services/notificationService.js
import { Expo } from 'expo-server-sdk';            // ⬅️ named import
import { supabaseAdmin } from './supabaseService.js';
import { sendConfirmationSms } from './telnyxService.js';

const expo = new Expo();

/* -------------------- helpers -------------------- */

function uniqStrings(arr = []) {
  return [...new Set((arr || []).filter(Boolean).map(String))];
}

async function sendPush(tokens = [], payload) {
  const cleaned = uniqStrings(tokens).filter((t) => Expo.isExpoPushToken(t));
  if (!cleaned.length) return [];

  const messages = cleaned.map((t) => ({
    to: t,
    sound: 'default',
    priority: 'high',
    ttl: 300,
    ...payload, // { title, body, data, categoryId? }
  }));

  const tickets = [];
  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (e) {
      console.error('[expo] push chunk failed:', e);
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
    console.error('[staffTokens] error:', error);
    return [];
  }
  return uniqStrings((data || []).map((r) => r.expo_push_token));
}

// Guests register via /app/push/register -> app_push_tokens
async function guestTokens(app_account_id) {
  if (!app_account_id) return [];
  const { data, error } = await supabaseAdmin
    .from('app_push_tokens')
    .select('expo_token')
    .eq('app_account_id', app_account_id);

  if (error) {
    console.error('[guestTokens] error:', error);
    return [];
  }
  return uniqStrings((data || []).map((r) => r.expo_token));
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
        screen: 'RequestDetail',
        request_id: requestRow.id,
        hotel_id: requestRow.hotel_id,
      },
      categoryId: 'REQUEST_CATEGORY', // matches app action buttons
    });
  } catch (e) {
    console.error('[notifyStaffOnNewRequest] failed:', e);
  }
}

/**
 * GUEST: status updates with single-channel delivery
 * - If the guest has app tokens: send a push
 * - Else (no tokens): send exactly one SMS
 */
export async function notifyGuestOnStatus(
  requestRow,
  status /* 'acknowledged' | 'completed' */
) {
  try {
    const appAccountId = requestRow.app_account_id || requestRow.appAccountId || null;
    const phone = requestRow.from_phone || requestRow.phone || null;

    const tokens = await guestTokens(appAccountId);

    const smsAck = 'Operon: Your request has been received and is being worked on.';
    const smsDone = 'Operon: Your request has been completed.';

    const pushTitle = status === 'acknowledged' ? 'We’re on it' : 'Completed';
    const pushBody = status === 'acknowledged' ? smsAck : smsDone;

    if (tokens.length) {
      await sendPush(tokens, {
        title: pushTitle,
        body: pushBody,
        data: {
          screen: 'RequestDetail',
          request_id: requestRow.id,
          event: status,
        },
      });
      return; // ✅ do not also SMS
    }

    // No app token? fall back to a single SMS
    if (phone) {
      // telnyx helper signature is (to, message)
      await sendConfirmationSms(phone, status === 'acknowledged' ? smsAck : smsDone);
    }
  } catch (e) {
    console.error('[notifyGuestOnStatus] failed:', e);
  }
}
