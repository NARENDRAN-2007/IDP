import pg from 'pg';
import { newDb, IMemoryDb } from 'pg-mem';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

export interface IDatabase {
  query(text: string, params?: any[]): Promise<pg.QueryResult>;
  getClient(): Promise<pg.PoolClient>;
  withTransaction<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T>;
  isInMemory(): boolean;
  close(): Promise<void>;
}

class DatabaseManager implements IDatabase {
  private pool: pg.Pool | null = null;
  private memDb: IMemoryDb | null = null;
  private isMemory = false;
  private initialized = false;

  public async init(): Promise<void> {
    if (this.initialized) return;

    if (config.databaseUrl && config.databaseUrl.trim() !== '') {
      try {
        const testPool = new Pool({
          connectionString: config.databaseUrl,
          connectionTimeoutMillis: 3000
        });
        // Test connection
        const client = await testPool.connect();
        client.release();
        this.pool = testPool;
        this.isMemory = false;
        this.initialized = true;
        logger.info('Connected to PostgreSQL database via DATABASE_URL');
        return;
      } catch (err: any) {
        logger.warn(
          { error: err.message },
          'Could not connect to external PostgreSQL database.'
        );
        if (!config.useInMemoryDbIfDisconnected) {
          throw err;
        }
      }
    }

    // Fallback to in-memory PostgreSQL simulation via pg-mem
    logger.info('Initializing in-memory PostgreSQL engine (pg-mem) for test/offline environment');
    this.memDb = newDb();
    
    // Register custom functions if necessary
    this.memDb.public.registerFunction({
      name: 'now',
      implementation: () => new Date()
    });

    const adapter = this.memDb.adapters.createPg();
    this.pool = new adapter.Pool();
    this.isMemory = true;
    this.initialized = true;
  }

  public async query(text: string, params?: any[]): Promise<pg.QueryResult> {
    await this.init();
    if (!this.pool) throw new Error('Database not initialized');
    return this.pool.query(text, params);
  }

  public async getClient(): Promise<pg.PoolClient> {
    await this.init();
    if (!this.pool) throw new Error('Database not initialized');
    return this.pool.connect();
  }

  public async withTransaction<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public isInMemory(): boolean {
    return this.isMemory;
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.initialized = false;
    }
  }
}

export const db = new DatabaseManager();
