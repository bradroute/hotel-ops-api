// src/middleware/validate.js
import { ZodError } from 'zod';

/**
 * Express middleware factory that validates req.body, req.query, and/or req.params
 * against zod schemas.
 *
 * Usage:
 *   router.post('/', validate({ body: myBodySchema }), handler);
 *   router.get('/',  validate({ query: myQuerySchema }), handler);
 */
export function validate(schemas) {
  return (req, res, next) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body ?? {});
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query ?? {});
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params ?? {});
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          issues: err.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }
      next(err);
    }
  };
}
