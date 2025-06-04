// src/utils/asyncWrapper.js

/**
 * Wraps an async route handler so you don’t have to write try/catch in every route.
 * Any thrown error will be passed to Express’s next() for centralized handling.
 */
function asyncWrapper(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncWrapper };
