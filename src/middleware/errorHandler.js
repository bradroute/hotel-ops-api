// src/middleware/errorHandler.js
import logger from '../lib/logger.js';

export function errorHandler(err, req, res, next) {
  const status = err.status || 500;

  // Avoid double responses
  if (res.headersSent) {
    return next(err);
  }

  // Tag log with route and method
  const route = `${req.method} ${req.originalUrl}`;
  logger.error({ err, route }, 'Unhandled error');

  // Provide safe JSON
  const body = { error: err.message || 'Internal Server Error' };
  if (err.payload) body.details = err.payload;

  res.status(status).json(body);
}
