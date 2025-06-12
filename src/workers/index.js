import dotenv from 'dotenv';
dotenv.config();

import * as ackReminderWorker from './ackReminderWorker.js';
import * as escalationWorker from './escalationWorker.js';

function startWorkers() {
  console.log('🚀 Starting HotelOps workers...');

  ackReminderWorker.start();
  escalationWorker.start();
}

startWorkers();
