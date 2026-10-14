import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  databaseUrl: process.env.DATABASE_URL || '',
  useInMemoryDbIfDisconnected: process.env.USE_IN_MEMORY_DB_IF_DISCONNECTED !== 'false',
  redisUrl: process.env.REDIS_URL || '',
  useInMemoryRedisIfDisconnected: process.env.USE_IN_MEMORY_REDIS_IF_DISCONNECTED !== 'false',
  jwtSecret: process.env.JWT_SECRET || 'emergency-hospital-access-secret-token-key-2026',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'emergency-hospital-refresh-secret-token-key-2026',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  orsApiKey: process.env.ORS_API_KEY || ''
};
