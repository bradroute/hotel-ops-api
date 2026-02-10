import 'dotenv/config';
import { start as startAck } from './ackReminderWorker.js';
import { start as startEsc } from './escalationWorker.js';
import logger from '../lib/logger.js';

logger.info('Starting HotelOps workers...');

// Start the ACK reminder and escalation workers
startAck();
startEsc();

