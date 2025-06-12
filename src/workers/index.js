import dotenv from 'dotenv';
dotenv.config();

// Polyfill for any leftover WebSocket usage
import { WebSocket } from 'ws';
global.WebSocket = WebSocket;

import { start as startAckReminder } from './ackReminderWorker.js';
import { start as startEscalation   } from './escalationWorker.js';

console.log('🚀 Starting HotelOps workers...');
startAckReminder();
startEscalation();

