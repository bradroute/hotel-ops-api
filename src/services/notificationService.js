// src/services/notificationService.js
import { Expo } from 'expo-server-sdk';
import { supabaseAdmin } from './supabaseService.js';
import { sendConfirmationSms } from './telnyxService.js';

const expo = new Expo();

/* -------------------- helpers -------------------- */

async function sendPush(tokens = [], payload) {
  if (!tokens?.length) return [];
  const messages = tokens
    .filter((t) => Expo.isExpoPushToken(t))
    .map((t) => ({
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
  return (data || []).map((r) => r.expo_push_token).filter(Boolean);
}

// 🔁 Guests register here in the app via /app/push/register -> app_push_tokens
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
  return (data || []).map((r) => r.expo_token).filter(Boolean);
}

/* -------------------- public API -------------------- */

/** STAFF: push when a new request is created */
export async function notifyStaffOnNewRequest(requestRow) {
  try {
    const tokens = await staffTokens(requestRow.hotel_id);
    if (!tokens.length) return;

    // Optional: show quick action buttons (ACK / DONE) in the app
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

    // Use the exact wording we decided on, so you don't get two different versions
    const smsAck =
      'Operon: Your request has been received and is being worked on.';
    const smsDone = 'Operon: Your request has been completed.';

    const pushTitle = status === 'acknowledged' ? 'We’re on it' : 'Completed';
    const pushBody =
      status === 'acknowledged'
        ? 'Your request has been received and is being worked on.'
        : 'Your request has been completed.';

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
      await sendConfirmationSms(status === 'acknowledged' ? smsAck : smsDone, phone);
    }
  } catch (e) {
    console.error('[notifyGuestOnStatus] failed:', e);
  }
}
