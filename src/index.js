// src/index.js

// A) Debug log at the very top
console.log('[DEBUG] src/index.js – starting up');

// B) Load environment variables from /.env
require('dotenv').config();

// C) Import the Express app from app.js
//    If this fails (e.g., syntax error in app.js),
//    we will not see the next debug message.
console.log('[DEBUG] src/index.js – about to require(\'./app\')');
const app = require('./app');
console.log('[DEBUG] src/index.js – required app successfully');

// D) Choose a port (use PORT env variable if set, otherwise default to 3001)
const PORT = process.env.PORT || 3001;

// E) Start listening
app.listen(PORT, () => {
  console.log(`[DEBUG] src/index.js – app.listen callback fired`);
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
