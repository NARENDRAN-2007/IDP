import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import { config } from '../config/env.js';
import { UnauthorizedError, ForbiddenError, NotFoundError } from '../errors/AppError.js';
import { logger } from '../utils/logger.js';

export interface UserTokenPayload {
  id: string;
  email: string;
  role: 'patient' | 'driver' | 'hospital_staff' | 'devops';
  entityId: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  entityId: string | null;
  createdAt: string;
}

export class AuthService {
  public static generateTokens(payload: UserTokenPayload): AuthTokens {
    const accessToken = jwt.sign(
      {
        id: payload.id,
        email: payload.email,
        role: payload.role,
        entityId: payload.entityId
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] }
    );

    const refreshToken = jwt.sign(
      {
        id: payload.id,
        email: payload.email,
        role: payload.role,
        entityId: payload.entityId
      },
      config.jwtRefreshSecret,
      { expiresIn: config.jwtRefreshExpiresIn as jwt.SignOptions['expiresIn'] }
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: config.jwtExpiresIn
    };
  }

  public static async loginHospitalStaff(email: string, password: string): Promise<{
    user: UserProfile;
    tokens: AuthTokens;
  }> {
    const normalizedEmail = email.trim().toLowerCase();
    const result = await db.query(
      `SELECT id, name, email, phone, password_hash, role, entity_id, created_at
       FROM users
       WHERE LOWER(email) = $1`,
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const row = result.rows[0];

    // Enforce hospital_staff role for hospital dashboard login
    if (row.role !== 'hospital_staff') {
      logger.warn({ email: normalizedEmail, role: row.role }, 'Non-hospital staff attempted hospital login');
      throw new ForbiddenError('Access restricted to hospital staff');
    }

    const isMatch = await bcrypt.compare(password, row.password_hash);
    if (!isMatch) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const user: UserProfile = {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      role: row.role,
      entityId: row.entity_id,
      createdAt: row.created_at
    };

    const tokens = this.generateTokens({
      id: user.id,
      email: user.email,
      role: user.role as any,
      entityId: user.entityId
    });

    // Record audit access log
    await db.query(
      `INSERT INTO audit_access_log (user_id, entity, entity_id, action, ts)
       VALUES ($1, 'auth', $2, 'LOGIN', NOW())`,
      [user.id, user.entityId || 'none']
    );

    return { user, tokens };
  }

  public static async refreshAccessToken(refreshToken: string): Promise<{
    tokens: AuthTokens;
    user: UserProfile;
  }> {
    try {
      const decoded = jwt.verify(refreshToken, config.jwtRefreshSecret) as UserTokenPayload;
      const result = await db.query(
        `SELECT id, name, email, phone, role, entity_id, created_at
         FROM users
         WHERE id = $1`,
        [decoded.id]
      );

      if (result.rows.length === 0) {
        throw new UnauthorizedError('User not found');
      }

      const row = result.rows[0];
      const user: UserProfile = {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        role: row.role,
        entityId: row.entity_id,
        createdAt: row.created_at
      };

      const tokens = this.generateTokens({
        id: user.id,
        email: user.email,
        role: user.role as any,
        entityId: user.entityId
      });

      return { tokens, user };
    } catch (err: any) {
      if (err instanceof UnauthorizedError) throw err;
      throw new UnauthorizedError('Invalid or expired refresh token');
    }
  }

  public static async getUserById(userId: string): Promise<UserProfile> {
    const result = await db.query(
      `SELECT id, name, email, phone, role, entity_id, created_at
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('User not found');
    }

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      role: row.role,
      entityId: row.entity_id,
      createdAt: row.created_at
    };
  }
}
