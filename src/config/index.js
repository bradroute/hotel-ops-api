// src/config/index.js

// Load environment variables from .env
require('dotenv').config();

module.exports = {
  telnyxApiKey: process.env.TELNYX_API_KEY,
  telnyxNumber: process.env.TELNYX_NUMBER,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_KEY,
  openAIApiKey: process.env.OPENAI_API_KEY,
  // (Add any future env vars here)
};
