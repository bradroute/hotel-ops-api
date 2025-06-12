import 'dotenv/config';
import { start as startAck } from './ackReminderWorker.js';
import { start as startEsc } from './escalationWorker.js';

console.log('🚀 Starting HotelOps workers...');
startAck();
startEsc();
