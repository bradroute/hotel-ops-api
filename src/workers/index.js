import dotenv from 'dotenv';
dotenv.config();

import ackReminderWorker from './ackReminderWorker.js';
import escalationWorker from './escalationWorker.js';

function startWorkers() {
  console.log('🚀 Starting HotelOps workers...');
  ackReminderWorker.start();
  escalationWorker.start();
}

startWorkers();
