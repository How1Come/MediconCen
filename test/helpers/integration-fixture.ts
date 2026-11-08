import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { ConsoleLogger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient } from '@redis/client';
import { config as loadEnvironmentFile } from 'dotenv';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Environment } from '../../src/config/environment';
import { createDatabaseOptions } from '../../src/database/database.options';
import { integrationEnvironment } from './integration-environment';

export interface IdentityPair {
  id1: string;
  id2: string;
}

type CacheOverrides = Partial<
  Pick<Environment, 'REDIS_ENABLED' | 'REDIS_PORT' | 'REDIS_TTL_SECONDS'>
>;

export class IntegrationFixture {
  readonly environment: Readonly<Environment>;
  readonly prefix = randomUUID();
  readonly database: DataSource;
  readonly redis: ReturnType<typeof createClient>;
  private readonly apps = new Set<INestApplication<Server>>();
  private readonly keys = new Set<string>();
  private readonly lockName: string;
  private lockRunner?: QueryRunner;
  private ownsSchema = false;

  private constructor(environment: Environment) {
    this.environment = Object.freeze({ ...environment });
    const config = new ConfigService<Environment, true>(environment);
    this.database = new DataSource(createDatabaseOptions(config));
    this.lockName = createHash('sha256')
      .update(`mediconcen-tests:${environment.MYSQL_DATABASE}`)
      .digest('hex');
    this.redis = createClient({
      username: environment.REDIS_USERNAME || undefined,
      password: environment.REDIS_PASSWORD || undefined,
      disableOfflineQueue: true,
      socket: {
        host: environment.REDIS_HOST,
        port: environment.REDIS_PORT,
        connectTimeout: 1000,
        reconnectStrategy: false,
      },
    });
    this.redis.on('error', () => undefined);
  }

  static async open(): Promise<IntegrationFixture> {
    loadEnvironmentFile({ path: resolve('.env.test'), quiet: true });
    const fixture = new IntegrationFixture(integrationEnvironment(process.env));

    try {
      await fixture.prepare();
      return fixture;
    } catch (error: unknown) {
      try {
        await fixture.close();
      } catch (cleanupError: unknown) {
        throw new AggregateError(
          [error, cleanupError],
          'Integration setup and cleanup both failed',
          { cause: cleanupError },
        );
      }

      throw error;
    }
  }

  pair(label: string): IdentityPair {
    return this.track({ id1: `${this.prefix}:${label}`, id2: 'pair' });
  }

  track(pair: IdentityPair): IdentityPair {
    this.keys.add(this.cacheKey(pair));
    return pair;
  }

  cacheKey(pair: IdentityPair): string {
    const hash = createHash('sha256')
      .update(JSON.stringify([pair.id1, pair.id2]))
      .digest('hex');

    return `mediconcen:identity:v1:${hash}`;
  }

  async createApp(
    overrides: CacheOverrides = {},
  ): Promise<INestApplication<Server>> {
    Object.assign(
      process.env,
      Object.fromEntries(
        Object.entries(this.environment).map(([name, value]) => [
          name,
          String(value),
        ]),
      ),
    );
    const { AppModule } = await import('../../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService<Environment, true>({
          ...this.environment,
          REDIS_ENABLED:
            overrides.REDIS_ENABLED ?? this.environment.REDIS_ENABLED,
          REDIS_PORT: overrides.REDIS_PORT ?? this.environment.REDIS_PORT,
          REDIS_TTL_SECONDS:
            overrides.REDIS_TTL_SECONDS ?? this.environment.REDIS_TTL_SECONDS,
        }),
      )
      .setLogger(new ConsoleLogger({ logLevels: [] }))
      .compile();
    const app = module.createNestApplication<INestApplication<Server>>({
      logger: false,
    });
    this.apps.add(app);
    await app.listen(0, '127.0.0.1');
    return app;
  }

  async closeApp(app: INestApplication<Server>): Promise<void> {
    await app.close();
    this.apps.delete(app);
  }

  post(app: INestApplication<Server>, body: unknown): request.Test {
    return request(app.getHttpServer())
      .post('/users/resolve')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body));
  }

  async waitFor(
    predicate: () => Promise<boolean>,
    description: string,
    timeout = 5000,
  ): Promise<void> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      if (await predicate()) {
        return;
      }

      await new Promise((done) => setTimeout(done, 25));
    }

    throw new Error(`Timed out waiting for ${description}`);
  }

  async close(): Promise<void> {
    const errors: unknown[] = [];
    const attempt = async (action: () => unknown): Promise<void> => {
      try {
        await action();
      } catch (error: unknown) {
        errors.push(error);
      }
    };

    for (const app of this.apps) {
      await attempt(() => app.close());
    }

    this.apps.clear();

    if (this.redis.isReady && this.keys.size > 0) {
      await attempt(() => this.redis.del([...this.keys]));
    }

    if (this.redis.isOpen) {
      await attempt(() => this.redis.destroy());
    }

    if (this.ownsSchema && this.database.isInitialized) {
      await attempt(() =>
        this.database.query('DROP TABLE IF EXISTS `identity_mappings`'),
      );
      await attempt(() =>
        this.database.query('DROP TABLE IF EXISTS `migrations`'),
      );
    }

    if (this.lockRunner && !this.lockRunner.isReleased) {
      const runner = this.lockRunner;
      await attempt(() =>
        runner.query('SELECT RELEASE_LOCK(?)', [this.lockName]),
      );
      await attempt(() => runner.release());
    }

    if (this.database.isInitialized) {
      await attempt(() => this.database.destroy());
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, 'Integration cleanup failed');
    }
  }

  private async prepare(): Promise<void> {
    await this.database.initialize();
    this.lockRunner = this.database.createQueryRunner();
    await this.lockRunner.connect();
    const locks = await this.database.query<
      Array<{ acquired: number | string | null }>
    >('SELECT GET_LOCK(?, 0) AS acquired', [this.lockName], this.lockRunner);

    if (Number(locks[0]?.acquired) !== 1) {
      throw new Error('The integration database is already in use');
    }

    const versions = await this.database.query<Array<{ version: string }>>(
      'SELECT VERSION() AS version',
    );

    if (!versions[0]?.version.startsWith('8.')) {
      throw new Error('Integration tests require MySQL 8');
    }

    const tables = await this.database.query<Array<{ name: string }>>(
      'SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema = DATABASE()',
    );

    if (tables.length > 0) {
      throw new Error('Integration tests require an empty test database');
    }

    this.ownsSchema = true;
    await this.database.runMigrations({ transaction: 'none' });
    await this.redis.connect();
  }
}
