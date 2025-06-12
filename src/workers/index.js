import dotenv from 'dotenv';
dotenv.config();

import ws from 'ws';
if (typeof global.WebSocket === 'undefined') {
  global.WebSocket = ws;
}

import { start as startAckReminderWorker } from './ackReminderWorker.js';
import { start as startEscalationWorker } from './escalationWorker.js';

function startWorkers() {
  console.log('🚀 Starting HotelOps workers...');
  startAckReminderWorker();
  startEscalationWorker();
}

startWorkers();
