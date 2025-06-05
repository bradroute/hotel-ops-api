// src/index.js

// A) Debug log at the very top
console.log('[DEBUG] src/index.js – starting up');

// B) Load environment variables from /.env
require('dotenv').config();

// C) Import the Express app from app.js
console.log('[DEBUG] src/index.js – about to require(\'./app\')');
const app = require('./app');
console.log('[DEBUG] src/index.js – required app successfully');

// ─────────────────────────────────────────────────────────────
//  Add your /health endpoint here, before calling app.listen
// ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});
// ─────────────────────────────────────────────────────────────

// D) Choose a port (use PORT env variable if set, otherwise default to 3001)
const PORT = process.env.PORT || 3001;

// E) Start listening
app.listen(PORT, () => {
  console.log(`[DEBUG] src/index.js – app.listen callback fired`);
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
