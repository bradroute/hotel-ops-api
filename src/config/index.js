// src/config/index.js
import dotenv from 'dotenv';
dotenv.config();

export const telnyxApiKey             = process.env.TELNYX_API_KEY;
export const telnyxNumber             = process.env.TELNYX_NUMBER;
export const telnyxMessagingProfileId = process.env.TELNYX_MESSAGING_PROFILE_ID;

export const supabaseUrl              = process.env.SUPABASE_URL;
export const supabaseKey              = process.env.SUPABASE_KEY;

export const openAIApiKey             = process.env.OPENAI_API_KEY;
export const managerPhone             = process.env.MANAGER_PHONE || '+11234567890';
