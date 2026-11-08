import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@redis/client';
import type { Environment } from '../config/environment';

const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

@Injectable()
export class IdentityCache implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdentityCache.name);
  private readonly client?: ReturnType<typeof createClient>;
  private readonly ttl: number;
  private readonly timeout: number;
  private unavailable = false;
  private closing = false;

  constructor(config: ConfigService<Environment, true>) {
    this.ttl = config.get('REDIS_TTL_SECONDS', { infer: true });
    this.timeout = config.get('REDIS_TIMEOUT_MS', { infer: true });

    if (!config.get('REDIS_ENABLED', { infer: true })) {
      return;
    }

    this.client = createClient({
      username: config.get('REDIS_USERNAME', { infer: true }) || undefined,
      password: config.get('REDIS_PASSWORD', { infer: true }) || undefined,
      disableOfflineQueue: true,
      commandsQueueMaxLength: 128,
      socket: {
        host: config.get('REDIS_HOST', { infer: true }),
        port: config.get('REDIS_PORT', { infer: true }),
        connectTimeout: this.timeout,
        reconnectStrategy: (retries) =>
          Math.min(100 * 2 ** Math.min(retries, 5), 2000),
      },
    });
    this.client.on('error', () => this.markUnavailable());
    this.client.on('ready', () => {
      this.unavailable = false;
    });
  }

  onModuleInit(): void {
    if (this.client) {
      void this.client.connect().catch(() => this.markUnavailable());
    }
  }

  onModuleDestroy(): void {
    this.closing = true;

    if (this.client?.isOpen) {
      this.client.destroy();
    }
  }

  async get(id1: string, id2: string): Promise<string | null> {
    const client = this.client;

    if (this.closing || !client?.isReady) {
      return null;
    }

    try {
      const value = await this.command((signal) =>
        client.withAbortSignal(signal).get(this.key(id1, id2)),
      );
      this.unavailable = false;

      return value !== null && uuidV4.test(value) ? value : null;
    } catch {
      this.markUnavailable();
      return null;
    }
  }

  async set(id1: string, id2: string, userID: string): Promise<void> {
    const client = this.client;

    if (this.closing || !client?.isReady || !uuidV4.test(userID)) {
      return;
    }

    try {
      await this.command((signal) =>
        client.withAbortSignal(signal).set(this.key(id1, id2), userID, {
          expiration: { type: 'EX', value: this.ttl },
        }),
      );
      this.unavailable = false;
    } catch {
      this.markUnavailable();
    }
  }

  private async command<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        operation(controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Redis command deadline exceeded'));
          }, this.timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private key(id1: string, id2: string): string {
    const digest = createHash('sha256')
      .update(JSON.stringify([id1, id2]))
      .digest('hex');

    return `mediconcen:identity:v1:${digest}`;
  }

  private markUnavailable(): void {
    if (!this.closing && !this.unavailable) {
      this.logger.warn('Redis cache unavailable; using MySQL');
      this.unavailable = true;
    }
  }
}
