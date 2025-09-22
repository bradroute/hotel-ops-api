// src/config/index.js
import dotenv from 'dotenv';
dotenv.config();

export const telnyxApiKey             = process.env.TELNYX_API_KEY;
export const telnyxNumber             = process.env.TELNYX_NUMBER;
export const telnyxMessagingProfileId = process.env.TELNYX_MESSAGING_PROFILE_ID;

export const supabaseUrl              = process.env.SUPABASE_URL;
export const supabaseKey              = process.env.SUPABASE_KEY;
export const supabaseServiceRoleKey   = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const openAIApiKey             = process.env.OPENAI_API_KEY;
export const managerPhone             = process.env.MANAGER_PHONE || '+11234567890';

// Base URL of your deployed API (used for Telnyx status webhooks)
export const apiBaseUrl               = process.env.API_BASE_URL;

console.log('🔗 Using Supabase URL:', supabaseUrl);
console.log('🌐 API Base URL:', apiBaseUrl);
