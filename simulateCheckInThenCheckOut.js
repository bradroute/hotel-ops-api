// simulateCheckInThenCheckOut.js
import dotenv from 'dotenv';
dotenv.config();

import { syncCheckIns } from './src/utils/pms.js';

// Node 24+ has global fetch built in—no need to import anything.

const HOTEL_ID = process.env.HOTEL_ID || '445e7485-e3a4-4535-9a6a-ebe4c344f4ab';

;(async () => {
  try {
    const now = new Date();
    const checkout = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    // 1) Simulate check-in
    await syncCheckIns([{
      phone: '+15558675309',
      room: '115',
      checkout,
      hotel_id: HOTEL_ID,
    }]);
    console.log('✅ Check-in simulated for Room 115');

    // 2) Simulate check-out
    const res = await fetch(`http://localhost:3001/rooms/115/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hotel_id: HOTEL_ID }),
    });
    const result = await res.json();
    console.log('✅ Checkout response:', result);

  } catch (err) {
    console.error('❌ Simulation error:', err);
  }
})();
