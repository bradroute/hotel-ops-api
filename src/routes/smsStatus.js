// src/routes/smsStatus.js
import express from 'express';
const router = express.Router();

router.post('/', (req, res) => {
  const evt = req.body?.data?.event_type;
  const id  = req.body?.data?.payload?.id;
  const to  = req.body?.data?.payload?.to?.[0]?.phone_number;
  const st  = req.body?.data?.payload?.to?.[0]?.status || req.body?.data?.payload?.status;

  // minimal, non-recursive logging
  if (evt && id) console.log(`📬 /sms-status evt=${evt} id=${id} to=${to} status=${st}`);
  return res.sendStatus(200);
});

export default router;
