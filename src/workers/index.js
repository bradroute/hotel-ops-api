// src/workers/index.js

import dotenv from 'dotenv';
dotenv.config();

// WebSocket polyfill (ESM-safe)
if (typeof global.WebSocket === 'undefined') {
  const ws = await import('ws');
  global.WebSocket = ws.default;
}

import { start as startAckReminderWorker } from './ackReminderWorker.js';
import { start as startEscalationWorker } from './escalationWorker.js';

function startWorkers() {
  console.log('🚀 Starting HotelOps workers...');
  startAckReminderWorker();
  startEscalationWorker();
}

startWorkers();
