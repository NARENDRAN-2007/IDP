import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { UserTokenPayload } from '../services/authService.js';

export interface BaseRealtimeEvent {
  eventId: string;
  requestId?: string;
  ts: string;
  [key: string]: any;
}

class RealtimeHub {
  private io: Server | null = null;

  public init(httpServer: HttpServer): Server {
    if (this.io) return this.io;

    this.io = new Server(httpServer, {
      cors: {
        origin: config.corsOrigin === '*' ? true : config.corsOrigin,
        credentials: true
      },
      pingTimeout: 10000,
      pingInterval: 5000
    });

    // JWT authentication middleware for Socket.IO connections (Plan 8.1)
    this.io.use((socket: Socket, next) => {
      try {
        const token =
          socket.handshake.auth?.token ||
          socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

        if (!token) {
          logger.warn({ socketId: socket.id }, 'Socket connection rejected: No JWT provided');
          return next(new Error('Authentication token required'));
        }

        const decoded = jwt.verify(token, config.jwtSecret) as UserTokenPayload;
        socket.data.user = decoded;
        next();
      } catch (err: any) {
        logger.warn({ socketId: socket.id, error: err.message }, 'Socket JWT verification failed');
        return next(new Error('Invalid or expired authentication token'));
      }
    });

    this.io.on('connection', (socket: Socket) => {
      const user = socket.data.user as UserTokenPayload;
      logger.info(
        { socketId: socket.id, userId: user.id, role: user.role, entityId: user.entityId },
        'Client connected to Socket.IO'
      );

      // Auto-join room based strictly on verified role and entityId (Plan 8.1)
      if (user.role === 'hospital_staff' && user.entityId) {
        const hospitalRoom = `hospital:${user.entityId}`;
        socket.join(hospitalRoom);
        logger.info({ socketId: socket.id, room: hospitalRoom }, 'Hospital staff joined room');
      }

      // Restrict arbitrary room joining
      socket.on('join_room', () => {
        socket.emit('error', { message: 'Arbitrary room joins are not permitted' });
      });

      socket.on('disconnect', (reason) => {
        logger.info({ socketId: socket.id, reason }, 'Socket disconnected');
      });
    });

    return this.io;
  }

  public getIO(): Server | null {
    return this.io;
  }

  /**
   * Dispatches an event strictly to a specific hospital room (Plan 8.1, 8.2).
   * Every event carries { eventId, requestId, ts }.
   */
  public emitToHospital(hospitalId: string, event: string, payload: Record<string, any>): void {
    if (!this.io) {
      logger.debug({ event, hospitalId }, 'Socket.IO not initialized, skipping emit');
      return;
    }

    const eventPayload: BaseRealtimeEvent = {
      eventId: `EVT_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      requestId: payload.requestId,
      ts: new Date().toISOString(),
      ...payload
    };

    const room = `hospital:${hospitalId}`;
    this.io.to(room).emit(event, eventPayload);
    logger.info({ event, room, eventId: eventPayload.eventId }, 'Realtime event emitted to hospital room');
  }

  /**
   * Helper emission methods cataloged in Plan 8.2
   */
  public emitHospitalProvisional(hospitalId: string, data: Record<string, any>) {
    this.emitToHospital(hospitalId, 'hospital.provisional', data);
  }

  public emitHoldCreated(hospitalId: string, data: Record<string, any>) {
    this.emitToHospital(hospitalId, 'hold.created', data);
  }

  public emitHoldCascaded(oldHospitalId: string, newHospitalId: string | null, data: Record<string, any>) {
    this.emitToHospital(oldHospitalId, 'hold.cascaded', {
      oldHospital: oldHospitalId,
      newHospital: newHospitalId,
      ...data
    });
    if (newHospitalId) {
      this.emitToHospital(newHospitalId, 'hold.cascaded', {
        oldHospital: oldHospitalId,
        newHospital: newHospitalId,
        ...data
      });
    }
  }

  public emitSeverityClassified(hospitalId: string, data: Record<string, any>) {
    this.emitToHospital(hospitalId, 'severity.classified', data);
  }

  public emitBedConfirmed(hospitalId: string, data: Record<string, any>) {
    this.emitToHospital(hospitalId, 'bed.confirmed', data);
  }

  public emitBedsUpdated(hospitalId: string, data: Record<string, any>) {
    this.emitToHospital(hospitalId, 'beds.updated', data);
  }

  public emitAmbulanceLocation(hospitalId: string, data: Record<string, any>) {
    this.emitToHospital(hospitalId, 'ambulance.location', data);
  }

  public emitVitalsUpdate(hospitalId: string, data: Record<string, any>) {
    this.emitToHospital(hospitalId, 'vitals.update', data);
  }

  public emitRequestCompleted(hospitalId: string, data: Record<string, any>) {
    this.emitToHospital(hospitalId, 'request.completed', data);
  }

  public close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.io) {
        this.io.close(() => {
          this.io = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

export const realtimeHub = new RealtimeHub();
