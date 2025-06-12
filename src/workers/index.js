require('dotenv').config();

const ackReminderWorker = require('./ackReminderWorker');
const escalationWorker = require('./escalationWorker');

function startWorkers() {
  console.log('🚀 Starting HotelOps workers...');

  ackReminderWorker.start();
  escalationWorker.start();
}

startWorkers();
