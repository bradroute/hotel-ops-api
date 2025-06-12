// src/workers/index.js

import dotenv from 'dotenv';
dotenv.config();

// Add WebSocket polyfill for Supabase compatibility (ESM-safe)
if (typeof WebSocket === 'undefined') {
  global.WebSocket = await import('ws').then(m => m.default);
}

import { start as startAckReminderWorker } from './ackReminderWorker.js';
import { start as startEscalationWorker } from './escalationWorker.js';

function startWorkers() {
  console.log('🚀 Starting HotelOps workers...');
  startAckReminderWorker();
  startEscalationWorker();
}

startWorkers();
