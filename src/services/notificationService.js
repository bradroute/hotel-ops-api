// src/services/notificationService.js
import { Expo } from 'expo-server-sdk';
import { supabaseAdmin } from './supabaseService.js';
import { sendConfirmationSms } from './telnyxService.js'; // already in your project

const expo = new Expo();

async function sendPush(tokens = [], payload) {
  if (!tokens.length) return [];
  const messages = tokens
    .filter(t => Expo.isExpoPushToken(t))
    .map(t => ({
      to: t,
      sound: 'default',
      priority: 'high',
      ttl: 300,
      ...payload, // { title, body, data }
    }));

  const tickets = [];
  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (e) {
      console.error('Expo push error:', e);
    }
  }
  return tickets;
}

async function staffTokens(hotel_id) {
  const { data, error } = await supabaseAdmin
    .from('staff_devices')
    .select('expo_push_token')
    .eq('hotel_id', hotel_id);

  if (error) {
    console.error('staffTokens error', error);
    return [];
  }
  return (data || []).map(r => r.expo_push_token);
}

async function guestTokens({ guest_user_id, phone }) {
  const ors = [];
  if (guest_user_id) ors.push(`guest_user_id.eq.${guest_user_id}`);
  if (phone) ors.push(`phone.eq.${phone}`);
  if (!ors.length) return [];
  const { data, error } = await supabaseAdmin
    .from('guest_devices')
    .select('expo_push_token')
    .or(ors.join(','));

  if (error) {
    console.error('guestTokens error', error);
    return [];
  }
  return (data || []).map(r => r.expo_push_token).filter(Boolean);
}

/** STAFF: on new request */
export async function notifyStaffOnNewRequest(requestRow) {
  try {
    const tokens = await staffTokens(requestRow.hotel_id);
    if (!tokens.length) return;

    await sendPush(tokens, {
      title: `New ${requestRow.department || 'Service'} Request`,
      body: requestRow.summary || requestRow.message || 'Open to view details.',
      data: { screen: 'RequestDetail', request_id: requestRow.id, hotel_id: requestRow.hotel_id },
    });
  } catch (e) {
    console.error('notifyStaffOnNewRequest failed', e);
  }
}

/** GUEST: on ack / complete (with SMS fallback) */
export async function notifyGuestOnStatus(requestRow, status /* 'acknowledged' | 'completed' */) {
  try {
    const phone = requestRow.phone || requestRow.from_phone || null;
    const tokens = await guestTokens({
      guest_user_id: requestRow.guest_user_id,
      phone,
    });

    const title = status === 'acknowledged' ? 'Request Acknowledged' : 'Request Completed';
    const body =
      status === 'acknowledged'
        ? 'A team member is on it.'
        : 'Your request has been completed. Thanks for using Operon!';

    if (tokens.length) {
      await sendPush(tokens, {
        title,
        body,
        data: { screen: 'MyRequests', request_id: requestRow.id },
      });
    } else if (phone) {
      // No app token? fall back to SMS
      await sendConfirmationSms(phone, body);
    }
  } catch (e) {
    console.error('notifyGuestOnStatus failed', e);
  }
}
