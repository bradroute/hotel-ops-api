import dotenv from 'dotenv';
dotenv.config();

// WebSocket polyfill
import WebSocket from 'isomorphic-ws';
global.WebSocket = WebSocket;

import { start as startAckReminderWorker } from './ackReminderWorker.js';
import { start as startEscalationWorker } from './escalationWorker.js';

function startWorkers() {
  console.log('🚀 Starting HotelOps workers...');
  startAckReminderWorker();
  startEscalationWorker();
}

startWorkers();
