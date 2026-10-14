import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthService } from '../services/authService.js';
import { validateBody } from '../middleware/validate.js';
import { authenticateJWT } from '../middleware/authMiddleware.js';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(255)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1)
});

/**
 * POST /api/auth/login
 * Hospital staff login
 */
authRouter.post(
  '/login',
  validateBody(loginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;
      const { user, tokens } = await AuthService.loginHospitalStaff(email, password);

      return res.status(200).json({
        ok: true,
        data: {
          user,
          tokens
        },
        error: null
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/auth/refresh
 * Refresh access token
 */
authRouter.post(
  '/refresh',
  validateBody(refreshSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = req.body;
      const { tokens, user } = await AuthService.refreshAccessToken(refreshToken);

      return res.status(200).json({
        ok: true,
        data: {
          user,
          tokens
        },
        error: null
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/auth/me
 * Current user profile and role
 */
authRouter.get(
  '/me',
  authenticateJWT,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await AuthService.getUserById(req.user!.id);

      return res.status(200).json({
        ok: true,
        data: {
          user
        },
        error: null
      });
    } catch (err) {
      next(err);
    }
  }
);
