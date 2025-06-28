// src/supabaseClient.js
import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseKey } from './config/index.js';

export const supabase = createClient(
  supabaseUrl,
  supabaseKey,
  { realtime: { enabled: false } }
);
