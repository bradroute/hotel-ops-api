import dotenv from 'dotenv';
dotenv.config();

// Polyfill WebSocket (Supabase realtime needs this on server-side Node)
if (typeof global.WebSocket === 'undefined') {
  const wsImport = await import('ws');
  global.WebSocket = wsImport.default;
}

import { start as startAckReminderWorker } from './ackReminderWorker.js';
import { start as startEscalationWorker } from './escalationWorker.js';

function startWorkers() {
  console.log('🚀 Starting HotelOps workers...');

  startAckReminderWorker();
  startEscalationWorker();
}

startWorkers();
