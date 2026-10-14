import express from 'express';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { authRouter } from './routes/auth.routes.js';
import { hospitalsRouter } from './routes/hospitals.routes.js';
import { simulateRouter } from './routes/simulate.routes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { NotFoundError } from './errors/AppError.js';

export const app = express();

app.use(
  cors({
    origin: config.corsOrigin === '*' ? true : config.corsOrigin,
    credentials: true
  })
);

app.use(express.json());

// Structured request logging with pino
if (process.env.NODE_ENV !== 'test') {
  app.use(
    pinoHttp({
      logger,
      customLogLevel: (_req, res, err) => {
        if (res.statusCode >= 500 || err) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      }
    })
  );
}

// Health Check
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString()
    },
    error: null
  });
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/hospitals', hospitalsRouter);
app.use('/api/simulate', simulateRouter);

// 404 Handler
app.use((req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
});

// Central Error Handler
app.use(errorHandler);
