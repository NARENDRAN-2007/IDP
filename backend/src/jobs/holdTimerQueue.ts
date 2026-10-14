import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

export interface HoldTimerData {
  holdId: string;
  requestId: string;
}

export type HoldTimerCallback = (data: HoldTimerData) => Promise<void>;

class HoldTimerManager {
  private queue: Queue<HoldTimerData> | null = null;
  private worker: Worker<HoldTimerData> | null = null;
  private redisClient: IORedis | null = null;
  private fallbackTimers: Map<string, NodeJS.Timeout> = new Map();
  private handler: HoldTimerCallback | null = null;
  private initialized = false;
  private useFallback = false;

  public setHandler(handler: HoldTimerCallback) {
    this.handler = handler;
  }

  public async init(): Promise<void> {
    if (this.initialized) return;

    if (config.redisUrl && config.redisUrl.trim() !== '') {
      try {
        const client = new IORedis(config.redisUrl, {
          maxRetriesPerRequest: null,
          connectTimeout: 2000,
          retryStrategy: () => null // don't retry endlessly if not running
        });

        await new Promise<void>((resolve, reject) => {
          client.once('ready', () => resolve());
          client.once('error', (err) => reject(err));
        });

        this.redisClient = client;
        this.queue = new Queue<HoldTimerData>('hold-timer-queue', { connection: this.redisClient });
        this.worker = new Worker<HoldTimerData>(
          'hold-timer-queue',
          async (job: Job<HoldTimerData>) => {
            logger.info({ holdId: job.data.holdId }, 'BullMQ hold timer fired');
            if (this.handler) {
              await this.handler(job.data);
            }
          },
          { connection: this.redisClient }
        );

        this.worker.on('failed', (job, err) => {
          logger.error({ holdId: job?.data.holdId, error: err.message }, 'Hold timer worker failed');
        });

        logger.info('Connected to Redis for BullMQ hold timers');
        this.useFallback = false;
        this.initialized = true;
        return;
      } catch (err: any) {
        logger.warn({ error: err.message }, 'Could not connect to Redis, falling back to in-process timer scheduler');
        if (!config.useInMemoryRedisIfDisconnected) {
          throw err;
        }
      }
    }

    // In-process fallback
    this.useFallback = true;
    this.initialized = true;
    logger.info('Initialized in-process timer scheduler (Redis-free fallback)');
  }

  public async scheduleHoldTimer(holdId: string, requestId: string, delayMs: number): Promise<void> {
    await this.init();

    if (!this.useFallback && this.queue) {
      await this.queue.add(
        'hold-expiry',
        { holdId, requestId },
        {
          delay: Math.max(0, delayMs),
          jobId: `hold-${holdId}`,
          removeOnComplete: true,
          removeOnFail: true
        }
      );
      return;
    }

    // In-process reliable timer
    this.clearFallbackTimer(holdId);
    const timeout = setTimeout(async () => {
      this.fallbackTimers.delete(holdId);
      logger.info({ holdId }, 'In-process hold timer fired');
      if (this.handler) {
        try {
          await this.handler({ holdId, requestId });
        } catch (err: any) {
          logger.error({ holdId, error: err.message }, 'Error in fallback timer handler');
        }
      }
    }, Math.max(0, delayMs));

    this.fallbackTimers.set(holdId, timeout);
  }

  public clearFallbackTimer(holdId: string): void {
    const timer = this.fallbackTimers.get(holdId);
    if (timer) {
      clearTimeout(timer);
      this.fallbackTimers.delete(holdId);
    }
  }

  public async close(): Promise<void> {
    for (const timer of this.fallbackTimers.values()) {
      clearTimeout(timer);
    }
    this.fallbackTimers.clear();

    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
    if (this.redisClient) {
      await this.redisClient.quit();
      this.redisClient = null;
    }
    this.initialized = false;
  }
}

export const holdTimerQueue = new HoldTimerManager();
