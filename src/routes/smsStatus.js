// src/routes/smsStatus.js
import express from 'express';
import logger from '../lib/logger.js';
const router = express.Router();

router.post('/', (req, res) => {
  const evt = req.body?.data?.event_type;
  const id  = req.body?.data?.payload?.id;
  const to  = req.body?.data?.payload?.to?.[0]?.phone_number;
  const st  = req.body?.data?.payload?.to?.[0]?.status || req.body?.data?.payload?.status;

  // minimal, non-recursive logging
  if (evt && id) logger.info({ evt, id, to, status: st }, 'sms-status webhook');
  return res.sendStatus(200);
});

export default router;
