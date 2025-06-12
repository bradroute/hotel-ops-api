export function errorHandler(err, req, res, next) {
  console.error(err.stack);
  if (err.payload) {
    return res.status(500).json({
      error: err.message,
      details: err.payload,
    });
  }
  res.status(500).json({ error: err.message || 'Internal Server Error' });
}
