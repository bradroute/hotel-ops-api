import dotenv from 'dotenv';
dotenv.config();

// WebSocket polyfill for Supabase Realtime
import ws from 'ws';
global.WebSocket = ws;

import { start as startAckReminderWorker } from './ackReminderWorker.js';
import { start as startEscalationWorker } from './escalationWorker.js';

function startWorkers() {
  console.log('🚀 Starting HotelOps workers...');
  startAckReminderWorker();
  startEscalationWorker();
}

startWorkers();
