// src/index.js

// Debug log
console.log('[DEBUG] src/index.js – starting up');

// Load env vars
import dotenv from 'dotenv';
dotenv.config();

// Import Express app
console.log('[DEBUG] src/index.js – about to import(\'./app.js\')');
import app from './app.js';
console.log('[DEBUG] src/index.js – imported app successfully');

// ─── Health check ───────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});
// ─────────────────────────────────────────────────────────────────────────

// Choose port (Render sets PORT=10000 internally)
const PORT = process.env.PORT || 3001;

// Start listening
app.listen(PORT, () => {
  console.log('[DEBUG] src/index.js – app.listen callback fired');
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
