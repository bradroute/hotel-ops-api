// src/services/pushService.js
// Node 18+ has global fetch. If you're on <18, `npm i node-fetch` and import it.
const EXPO_URL = 'https://exp.host/--/api/v2/push/send';

function uniqTokens(tokens = []) {
  return [...new Set(tokens)].filter(t => typeof t === 'string' && t.startsWith('ExponentPushToken'));
}

export async function sendExpoPush(tokens, { title, body, data = {} }) {
  const list = uniqTokens(tokens);
  if (!list.length) {
    console.log('[push] no tokens to send');
    return { sent: 0, tickets: [] };
  }

  // Expo recommends batches up to ~100
  const chunks = [];
  for (let i = 0; i < list.length; i += 99) chunks.push(list.slice(i, i + 99));

  const tickets = [];
  for (const chunk of chunks) {
    const messages = chunk.map(to => ({
      to,
      title,
      body,
      data,
      sound: null,
      priority: 'high',
    }));

    const res = await fetch(EXPO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });

    let json = {};
    try { json = await res.json(); } catch {}
    tickets.push(json);
    console.log('[push] expo response:', JSON.stringify(json).slice(0, 400));
  }

  return { sent: list.length, tickets };
}
