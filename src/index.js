import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import app from './app.js';
import requestsRouter from './routes/requests.js';

const PORT = process.env.PORT || 3001;

// Must parse JSON bodies before your routes
app.use(express.json());

// Mount your requests API under /requests
app.use('/requests', requestsRouter);

app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
