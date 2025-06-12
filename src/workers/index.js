require('dotenv').config();

// 👉 WebSocket polyfill for Supabase realtime inside worker:
if (typeof global.WebSocket === 'undefined') {
  global.WebSocket = require('ws');
}

const ackReminderWorker = require('./ackReminderWorker');
const escalationWorker = require('./escalationWorker');

function startWorkers() {
  console.log('🚀 Starting HotelOps workers...');

  ackReminderWorker.start();
  escalationWorker.start();
}

startWorkers();
