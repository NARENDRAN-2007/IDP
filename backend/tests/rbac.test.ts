import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { seedDatabase } from '../src/db/seed.js';
import { AuthService } from '../src/services/authService.js';
import { authenticateJWT, requireHospitalStaff, requireHospitalScope } from '../src/middleware/authMiddleware.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

describe('Phase 1: RBAC & Hospital Data Isolation (Plan 13)', () => {
  let testApp: express.Express;
  let h001Token: string;
  let h002Token: string;

  beforeAll(async () => {
    await seedDatabase();

    const h001Login = await AuthService.loginHospitalStaff('staff_h001@hospital.er', 'Password123!');
    h001Token = h001Login.tokens.accessToken;

    const h002Login = await AuthService.loginHospitalStaff('staff_h002@hospital.er', 'Password123!');
    h002Token = h002Login.tokens.accessToken;

    testApp = express();
    testApp.use(express.json());

    // Protected hospital route requiring staff role and hospital scope matching :id
    testApp.get(
      '/api/hospitals/:id/test-desk',
      authenticateJWT,
      requireHospitalStaff,
      requireHospitalScope('id'),
      (req, res) => {
        res.status(200).json({
          ok: true,
          data: {
            message: `Welcome to hospital ${req.params.id} desk`,
            staffEntityId: req.user?.entityId
          },
          error: null
        });
      }
    );

    testApp.use(errorHandler);
  });

  it('should allow hospital staff to access their own hospital desk', async () => {
    const res = await request(testApp)
      .get('/api/hospitals/H001/test-desk')
      .set('Authorization', `Bearer ${h001Token}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.staffEntityId).toBe('H001');
  });

  it('should FORBID hospital staff from accessing another hospital desk (403 FORBIDDEN)', async () => {
    // H001 staff attempting to access H002 desk
    const res = await request(testApp)
      .get('/api/hospitals/H002/test-desk')
      .set('Authorization', `Bearer ${h001Token}`);

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toContain('cannot access data for hospital H002');
  });

  it('should reject unauthenticated access with 401 UNAUTHORIZED', async () => {
    const res = await request(testApp).get('/api/hospitals/H001/test-desk');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
