/**
 * Central error‐handling middleware.
 * Any Error thrown in an asyncWrapper route will end up here.
 */
export function errorHandler(err, req, res, next) {
  console.error(err.stack);

  // If err.payload (e.g. Telnyx sending error) exists, include it
  if (err.payload) {
    return res.status(500).json({
      error: err.message,
      details: err.payload,
    });
  }

  res.status(500).json({ error: err.message || 'Internal Server Error' });
}
