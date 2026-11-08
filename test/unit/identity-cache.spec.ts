import { EventEmitter } from 'node:events';
import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@redis/client';
import { IdentityCache } from '../../src/cache/identity-cache.service';
import type { Environment } from '../../src/config/environment';

jest.mock('@redis/client', () => ({ createClient: jest.fn() }));

const userID = '550e8400-e29b-41d4-a716-446655440000';
const warnLog = jest.fn<(...args: unknown[]) => void>();

class RedisFake extends EventEmitter {
  isReady = true;
  isOpen = true;
  get = jest
    .fn<(key: string) => Promise<string | null>>()
    .mockResolvedValue(null);
  set = jest
    .fn<
      (
        key: string,
        value: string,
        options: { expiration: { type: 'EX'; value: number } },
      ) => Promise<'OK'>
    >()
    .mockResolvedValue('OK');
  connect = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
  destroy = jest.fn<() => void>().mockImplementation(() => {
    this.isOpen = false;
    this.isReady = false;
  });
  withAbortSignal = jest
    .fn<(signal: AbortSignal) => RedisFake>()
    .mockImplementation(() => this);
}

function configuration(
  overrides: Partial<Environment> = {},
): ConfigService<Environment, true> {
  return new ConfigService<Environment, true>({
    REDIS_ENABLED: true,
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: 6379,
    REDIS_USERNAME: '',
    REDIS_PASSWORD: '',
    REDIS_TTL_SECONDS: 300,
    REDIS_TIMEOUT_MS: 200,
    ...overrides,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

describe('IdentityCache', () => {
  let redis: RedisFake;

  beforeEach(() => {
    redis = new RedisFake();
    jest.mocked(createClient).mockReset();
    jest
      .mocked(createClient)
      .mockReturnValue(redis as unknown as ReturnType<typeof createClient>);
    warnLog.mockClear();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(warnLog);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns a canonical UUID v4 cache hit', async () => {
    redis.get.mockResolvedValue(userID);
    const cache = new IdentityCache(configuration());

    await expect(cache.get('ABC123', 'XYZ456')).resolves.toBe(userID);
  });

  it.each([
    null,
    '',
    'not-a-uuid',
    userID.toUpperCase(),
    '550e8400-e29b-11d4-a716-446655440000',
    '550e8400-e29b-41d4-7716-446655440000',
  ])(
    'treats an invalid or missing cached value %p as a miss',
    async (value) => {
      redis.get.mockResolvedValue(value);
      const cache = new IdentityCache(configuration());

      await expect(cache.get('A', 'B')).resolves.toBeNull();
    },
  );

  it('uses one expiring key per exact ordered pair', async () => {
    const cache = new IdentityCache(configuration({ REDIS_TTL_SECONDS: 42 }));
    const pairs: Array<[string, string]> = [
      ['A', 'B'],
      ['B', 'A'],
      ['a', 'B'],
      ['A ', 'B'],
      ['A', 'B '],
      ['a:b', 'c'],
      ['a', 'b:c'],
      ['é', 'x'],
      ['e\u0301', 'x'],
    ];

    for (const [id1, id2] of pairs) {
      await cache.set(id1, id2, userID);
    }

    const keys = redis.set.mock.calls.map(([key]) => key);
    expect(new Set(keys).size).toBe(pairs.length);
    expect(
      keys.every((key) => /^mediconcen:identity:v1:[0-9a-f]{64}$/.test(key)),
    ).toBe(true);
    expect(redis.set).toHaveBeenCalledWith(expect.any(String), userID, {
      expiration: { type: 'EX', value: 42 },
    });

    await cache.get('A', 'B');
    expect(redis.get).toHaveBeenCalledWith(keys[0]);
    expect(redis.set).toHaveBeenCalledTimes(pairs.length);
  });

  it('turns GET errors into misses and SET errors into successful no-ops', async () => {
    redis.get.mockRejectedValue(new Error('WRONGTYPE private identifier'));
    redis.set.mockRejectedValue(
      new Error('connection lost private identifier'),
    );
    const cache = new IdentityCache(configuration());

    await expect(cache.get('A', 'B')).resolves.toBeNull();
    await expect(cache.set('A', 'B', userID)).resolves.toBeUndefined();
    expect(warnLog).toHaveBeenCalledTimes(1);
    expect(warnLog).toHaveBeenCalledWith(
      'Redis cache unavailable; using MySQL',
    );
  });

  it('does not write malformed UUIDs or extend expiration on a cache hit', async () => {
    redis.get.mockResolvedValue(userID);
    const cache = new IdentityCache(configuration());

    await cache.set('A', 'B', 'not-a-uuid');
    await cache.set('A', 'B', userID.toUpperCase());
    await cache.get('A', 'B');

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('skips I/O while disconnected and resumes once ready', async () => {
    redis.isReady = false;
    const cache = new IdentityCache(configuration());

    await expect(cache.get('A', 'B')).resolves.toBeNull();
    await cache.set('A', 'B', userID);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();

    redis.isReady = true;
    redis.emit('ready');
    redis.get.mockResolvedValue(userID);
    await expect(cache.get('A', 'B')).resolves.toBe(userID);
  });

  it('does not create or connect a client when caching is disabled', async () => {
    const cache = new IdentityCache(configuration({ REDIS_ENABLED: false }));

    expect(cache.onModuleInit()).toBeUndefined();
    await expect(cache.get('A', 'B')).resolves.toBeNull();
    await cache.set('A', 'B', userID);
    cache.onModuleDestroy();

    expect(createClient).not.toHaveBeenCalled();
    expect(redis.connect).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('starts connection work without waiting for Redis', () => {
    redis.connect.mockReturnValue(deferred<void>().promise);
    const cache = new IdentityCache(configuration());

    expect(cache.onModuleInit()).toBeUndefined();
    expect(redis.connect).toHaveBeenCalledTimes(1);
    expect(redis.listenerCount('error')).toBeGreaterThan(0);
    cache.onModuleDestroy();
    expect(redis.destroy).toHaveBeenCalledTimes(1);
  });

  it('handles background connection failures and client error events', async () => {
    redis.connect.mockRejectedValue(new Error('private connection details'));
    const cache = new IdentityCache(configuration());

    cache.onModuleInit();
    await Promise.resolve();
    expect(() =>
      redis.emit('error', new Error('private details')),
    ).not.toThrow();
    expect(warnLog).toHaveBeenCalledWith(
      'Redis cache unavailable; using MySQL',
    );
  });

  it('stops I/O after shutdown even if a late ready event arrives', async () => {
    const cache = new IdentityCache(configuration());
    cache.onModuleDestroy();
    redis.isReady = true;
    redis.emit('ready');

    await expect(cache.get('A', 'B')).resolves.toBeNull();
    await cache.set('A', 'B', userID);
    expect(redis.destroy).toHaveBeenCalledTimes(1);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('bounds stalled commands and consumes rejections arriving after the deadline', async () => {
    jest.useFakeTimers();
    const read = deferred<string | null>();
    const write = deferred<'OK'>();
    redis.get.mockReturnValue(read.promise);
    redis.set.mockReturnValue(write.promise);
    const cache = new IdentityCache(configuration());

    const pendingRead = cache.get('A', 'B');
    const pendingWrite = cache.set('A', 'B', userID);
    await jest.advanceTimersByTimeAsync(200);

    await expect(pendingRead).resolves.toBeNull();
    await expect(pendingWrite).resolves.toBeUndefined();
    expect(
      redis.withAbortSignal.mock.calls.every(([signal]) => signal.aborted),
    ).toBe(true);
    expect(jest.getTimerCount()).toBe(0);

    read.reject(new Error('late GET failure'));
    write.reject(new Error('late SET failure'));
    await Promise.resolve();
  });
});
