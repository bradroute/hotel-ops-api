// src/config/index.js
import dotenv from 'dotenv';
dotenv.config();

// NOTE: logger is imported lazily below to avoid circular dependency
// (logger.js may depend on config indirectly). We log after exports.

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

// Deferred startup log (avoids circular imports)
import logger from '../lib/logger.js';
logger.info({ supabaseUrl, apiBaseUrl }, 'Config loaded');
