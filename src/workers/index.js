import ws from 'ws';
global.WebSocket = ws;

import dotenv from 'dotenv';
dotenv.config();

import { start as startAckReminderWorker } from './ackReminderWorker.js';
import { start as startEscalationWorker } from './escalationWorker.js';

function startWorkers() {
  console.log('🚀 Starting HotelOps workers...');
  startAckReminderWorker();
  startEscalationWorker();
}

startWorkers();
