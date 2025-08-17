// lightweight Expo Push sender (uses global fetch on Node 18+)
export async function sendExpoPush(tokens = [], message = {}) {
  if (!Array.isArray(tokens) || tokens.length === 0) return;

  // Expo allows batch send; keep chunks <= 100
  for (let i = 0; i < tokens.length; i += 100) {
    const chunk = tokens.slice(i, i + 100).map((to) => ({
      to,
      sound: 'default',
      ...message, // {title, body, data}
    }));

    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error('[push] Expo returned non-OK:', text);
      }
    } catch (err) {
      console.error('[push] send failed:', err);
    }
  }
}
