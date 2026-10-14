import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { UnauthorizedError, ForbiddenError } from '../errors/AppError.js';
import { UserTokenPayload } from '../services/authService.js';

declare global {
  namespace Express {
    interface Request {
      user?: UserTokenPayload;
    }
  }
}

export function authenticateJWT(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Bearer token is required'));
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as UserTokenPayload;
    req.user = decoded;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return next(new UnauthorizedError('Access token has expired'));
    }
    return next(new UnauthorizedError('Invalid access token'));
  }
}

export function requireRole(role: 'patient' | 'driver' | 'hospital_staff' | 'devops') {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }
    if (req.user.role !== role) {
      return next(new ForbiddenError(`Access denied. Requires '${role}' role.`));
    }
    next();
  };
}

export const requireHospitalStaff = requireRole('hospital_staff');

/**
 * Enforces single-hospital data isolation:
 * Hospital staff can only access data belonging to their assigned hospital_id (Plan 13).
 */
export function requireHospitalScope(paramName = 'id') {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }
    const targetHospitalId = req.params[paramName];
    if (!targetHospitalId) {
      return next();
    }
    if (req.user.entityId !== targetHospitalId) {
      return next(
        new ForbiddenError(
          `Staff of hospital ${req.user.entityId} cannot access data for hospital ${targetHospitalId}`
        )
      );
    }
    next();
  };
}
