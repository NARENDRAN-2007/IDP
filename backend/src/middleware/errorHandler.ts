import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';
import { logger } from '../utils/logger.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    logger.warn(
      {
        code: err.code,
        statusCode: err.statusCode,
        path: req.path,
        method: req.method,
        details: err.details
      },
      err.message
    );

    return res.status(err.statusCode).json({
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details
      }
    });
  }

  // Unhandled / Unexpected error
  logger.error(
    {
      path: req.path,
      method: req.method,
      stack: err.stack
    },
    `Unhandled error: ${err.message}`
  );

  return res.status(500).json({
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected internal error occurred'
    }
  });
}
