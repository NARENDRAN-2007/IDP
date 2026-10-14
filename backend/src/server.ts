import http from 'http';
import { app } from './app.js';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { seedDatabase } from './db/seed.js';
import { BedReservationService } from './services/bedReservationService.js';
import { realtimeHub } from './realtime/socket.js';

export const server = http.createServer(app);

async function startServer() {
  try {
    logger.info('Initializing database and running migrations...');
    await seedDatabase();
    await BedReservationService.init();
    realtimeHub.init(server);

    server.listen(config.port, () => {
      logger.info(`Hospital Dashboard Backend running on port ${config.port} [${config.nodeEnv}]`);
    });
  } catch (err: any) {
    logger.error({ error: err.message }, 'Failed to start server');
    process.exit(1);
  }
}

if (process.argv[1] && (/server\.(ts|js)$/).test(process.argv[1])) {
  startServer();
}
