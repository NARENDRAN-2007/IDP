import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { app } from '../src/app.js';
import { seedDatabase } from '../src/db/seed.js';
import { AuthService } from '../src/services/authService.js';
import { realtimeHub } from '../src/realtime/socket.js';

describe('Phase 3: Realtime Socket.IO Hub & Room Isolation (Plan 8.1, 8.2)', () => {
  let httpServer: http.Server;
  let port: number;
  let h001Token: string;
  let h002Token: string;

  beforeAll(async () => {
    await seedDatabase();

    const h001Login = await AuthService.loginHospitalStaff('staff_h001@hospital.er', 'Password123!');
    h001Token = h001Login.tokens.accessToken;

    const h002Login = await AuthService.loginHospitalStaff('staff_h002@hospital.er', 'Password123!');
    h002Token = h002Login.tokens.accessToken;

    httpServer = http.createServer(app);
    realtimeHub.init(httpServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        port = typeof addr === 'object' && addr ? addr.port : 8000;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await realtimeHub.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it('CRITICAL REALTIME REQUIREMENT: a hospital client must NEVER receive another hospital events', async () => {
    // 1. Connect Client for Hospital H001
    const socketH001: ClientSocketType = ClientSocket(`http://localhost:${port}`, {
      auth: { token: h001Token },
      transports: ['websocket']
    });

    // 2. Connect Client for Hospital H002
    const socketH002: ClientSocketType = ClientSocket(`http://localhost:${port}`, {
      auth: { token: h002Token },
      transports: ['websocket']
    });

    await Promise.all([
      new Promise<void>((resolve) => socketH001.on('connect', () => resolve())),
      new Promise<void>((resolve) => socketH002.on('connect', () => resolve()))
    ]);

    const h001ReceivedEvents: any[] = [];
    const h002ReceivedEvents: any[] = [];

    socketH001.on('hospital.provisional', (data) => h001ReceivedEvents.push(data));
    socketH002.on('hospital.provisional', (data) => h002ReceivedEvents.push(data));

    socketH001.on('ambulance.location', (data) => h001ReceivedEvents.push(data));
    socketH002.on('ambulance.location', (data) => h002ReceivedEvents.push(data));

    // 3. Emit hospital.provisional STRICTLY to H001
    realtimeHub.emitHospitalProvisional('H001', {
      requestId: 'REQ_REALTIME_ISOLATION_H001',
      holdId: 'HOLD_TEST_001',
      expiresAt: new Date().toISOString(),
      bedType: 'ER'
    });

    // 4. Emit ambulance.location STRICTLY to H002
    realtimeHub.emitAmbulanceLocation('H002', {
      requestId: 'REQ_REALTIME_ISOLATION_H002',
      ambulanceId: 'A002',
      lat: 13.07,
      lng: 80.22,
      speed: 40
    });

    // Wait 300 ms for event delivery
    await new Promise((r) => setTimeout(r, 300));

    // Client H001 must receive its event with { eventId, requestId, ts }
    expect(h001ReceivedEvents.length).toBe(1);
    expect(h001ReceivedEvents[0].requestId).toBe('REQ_REALTIME_ISOLATION_H001');
    expect(h001ReceivedEvents[0].eventId).toBeDefined();
    expect(h001ReceivedEvents[0].ts).toBeDefined();

    // Client H002 must NEVER receive H001's event
    const h002ReceivedH001Event = h002ReceivedEvents.find(
      (e) => e.requestId === 'REQ_REALTIME_ISOLATION_H001'
    );
    expect(h002ReceivedH001Event).toBeUndefined();

    // Client H002 must receive its own event
    expect(h002ReceivedEvents.length).toBe(1);
    expect(h002ReceivedEvents[0].requestId).toBe('REQ_REALTIME_ISOLATION_H002');

    // Client H001 must NEVER receive H002's event
    const h001ReceivedH002Event = h001ReceivedEvents.find(
      (e) => e.requestId === 'REQ_REALTIME_ISOLATION_H002'
    );
    expect(h001ReceivedH002Event).toBeUndefined();

    socketH001.disconnect();
    socketH002.disconnect();
  });

  it('should reject unauthenticated socket connections without JWT', async () => {
    const unauthSocket = ClientSocket(`http://localhost:${port}`, {
      transports: ['websocket']
    });

    const errorPromise = new Promise<string>((resolve) => {
      unauthSocket.on('connect_error', (err) => {
        resolve(err.message);
      });
    });

    const msg = await errorPromise;
    expect(msg).toContain('Authentication token required');
    unauthSocket.disconnect();
  });

  it('should reject socket connection with invalid JWT', async () => {
    const invalidSocket = ClientSocket(`http://localhost:${port}`, {
      auth: { token: 'invalid.jwt.token' },
      transports: ['websocket']
    });

    const errorPromise = new Promise<string>((resolve) => {
      invalidSocket.on('connect_error', (err) => {
        resolve(err.message);
      });
    });

    const msg = await errorPromise;
    expect(msg).toContain('Invalid or expired authentication token');
    invalidSocket.disconnect();
  });
});
