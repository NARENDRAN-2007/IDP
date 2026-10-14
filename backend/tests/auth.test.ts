import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedDatabase } from '../src/db/seed.js';

describe('Phase 1: Auth Endpoints (Plan 7.1)', () => {
  beforeAll(async () => {
    await seedDatabase();
  });

  describe('POST /api/auth/login', () => {
    it('should successfully log in hospital staff with correct credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'staff_h002@hospital.er',
          password: 'Password123!'
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.error).toBeNull();
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.email).toBe('staff_h002@hospital.er');
      expect(res.body.data.user.role).toBe('hospital_staff');
      expect(res.body.data.user.entityId).toBe('H002');

      expect(res.body.data.tokens).toBeDefined();
      expect(res.body.data.tokens.accessToken).toBeDefined();
      expect(res.body.data.tokens.refreshToken).toBeDefined();
    });

    it('should reject login with wrong password (401 UNAUTHORIZED)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'staff_h002@hospital.er',
          password: 'WrongPassword'
        });

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toBe('Invalid email or password');
    });

    it('should reject login with non-existent email (401 UNAUTHORIZED)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'unknown@hospital.er',
          password: 'Password123!'
        });

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 400 VALIDATION_ERROR on malformed email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'not-an-email',
          password: 'Password123!'
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should return a new access token when provided a valid refresh token', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'staff_h001@hospital.er',
          password: 'Password123!'
        });

      const refreshToken = loginRes.body.data.tokens.refreshToken;

      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken });

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.ok).toBe(true);
      expect(refreshRes.body.data.tokens.accessToken).toBeDefined();
      expect(refreshRes.body.data.user.entityId).toBe('H001');
    });

    it('should reject invalid refresh token with 401 UNAUTHORIZED', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid.token.here' });

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return current user profile when given valid access token', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'staff_h003@hospital.er',
          password: 'Password123!'
        });

      const token = loginRes.body.data.tokens.accessToken;

      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.ok).toBe(true);
      expect(meRes.body.data.user.email).toBe('staff_h003@hospital.er');
      expect(meRes.body.data.user.role).toBe('hospital_staff');
      expect(meRes.body.data.user.entityId).toBe('H003');
    });

    it('should reject request without Bearer token (401 UNAUTHORIZED)', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });
});
