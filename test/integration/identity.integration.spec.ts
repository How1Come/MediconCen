import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createServer } from 'node:net';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { QueryFailedError } from 'typeorm';
import type { Environment } from '../../src/config/environment';
import { IdentityMapping } from '../../src/identity/identity.entity';
import { IdentityRepository } from '../../src/identity/identity.repository';
import { IntegrationFixture } from '../helpers/integration-fixture';
import type { IdentityPair } from '../helpers/integration-fixture';

const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function userID(response: request.Response): string {
  expect(response.status).toBe(200);
  const body: unknown = response.body;

  if (
    typeof body !== 'object' ||
    body === null ||
    !('userID' in body) ||
    typeof body.userID !== 'string'
  ) {
    throw new Error('Expected a JSON object containing a string userID');
  }

  expect(Object.keys(body)).toEqual(['userID']);
  expect(body.userID).toMatch(uuidV4);
  return body.userID;
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('Unable to allocate a local test port');
  }

  await new Promise<void>((done, fail) =>
    server.close((error) => (error ? fail(error) : done())),
  );
  return address.port;
}

describe('Identity API with MySQL and Redis', () => {
  let fixture: IntegrationFixture;
  let app: INestApplication<Server>;
  let other: INestApplication<Server>;

  beforeAll(async () => {
    fixture = await IntegrationFixture.open();
    app = await fixture.createApp();
    other = await fixture.createApp();
  }, 30000);

  afterAll(async () => {
    await fixture?.close();
  });

  async function stored(pair: IdentityPair): Promise<IdentityMapping[]> {
    return fixture.database.getRepository(IdentityMapping).findBy(pair);
  }

  async function warm(pair: IdentityPair): Promise<string> {
    const id = userID(await fixture.post(app, pair));
    await fixture.waitFor(async () => {
      await fixture.post(app, pair);
      return (await fixture.redis.get(fixture.cacheKey(pair))) === id;
    }, 'the confirmed mapping to reach Redis');
    return id;
  }

  it('does not rerun an applied migration or propose schema changes', async () => {
    await expect(
      fixture.database.runMigrations({ transaction: 'none' }),
    ).resolves.toEqual([]);
    const changes = await fixture.database.driver.createSchemaBuilder().log();
    expect(changes.upQueries).toEqual([]);
  });

  it('creates a UUID v4, persists it and returns only userID', async () => {
    const pair = fixture.pair('new');
    const id = userID(await fixture.post(app, pair));
    expect(await stored(pair)).toEqual([{ ...pair, userID: id }]);
  });

  it('returns the persisted ID across independent application instances', async () => {
    const pair = fixture.pair('existing');
    const id = userID(await fixture.post(app, pair));
    expect(userID(await fixture.post(app, pair))).toBe(id);
    expect(userID(await fixture.post(other, pair))).toBe(id);
    expect(await stored(pair)).toHaveLength(1);
  });

  it('returns distinct IDs for distinct pairs', async () => {
    const first = userID(await fixture.post(app, fixture.pair('distinct-a')));
    const second = userID(await fixture.post(app, fixture.pair('distinct-b')));
    expect(second).not.toBe(first);
  });

  it('uses the database unique index for simultaneous first requests', async () => {
    const pair = fixture.pair('concurrent');
    const responses = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        fixture.post(index % 2 === 0 ? app : other, pair),
      ),
    );
    const ids = new Set(responses.map(userID));
    expect(ids.size).toBe(1);
    expect(await stored(pair)).toEqual([{ ...pair, userID: [...ids][0] }]);
    await fixture.waitFor(async () => {
      return (await fixture.redis.get(fixture.cacheKey(pair))) === [...ids][0];
    }, 'the concurrent winner to reach Redis');
  });

  it('rejects duplicate pairs and null identifiers at the database boundary', async () => {
    const pair = fixture.pair('constraints');
    userID(await fixture.post(app, pair));
    await expect(
      fixture.database
        .getRepository(IdentityMapping)
        .insert({ ...pair, userID: randomUUID() }),
    ).rejects.toMatchObject({ driverError: { code: 'ER_DUP_ENTRY' } });
    await expect(
      fixture.database.query(
        'INSERT INTO identity_mappings (userID, id1, id2) VALUES (?, ?, ?)',
        [randomUUID(), null, 'invalid'],
      ),
    ).rejects.toMatchObject({ driverError: { code: 'ER_BAD_NULL_ERROR' } });
  });

  it.each([
    ['missing', {}],
    ['null field', { id1: null, id2: 'valid' }],
    ['numeric field', { id1: 123, id2: 'valid' }],
    ['array field', { id1: ['value'], id2: 'valid' }],
    ['nested field', { id1: { nested: { value: 'value' } }, id2: 'valid' }],
    ['empty field', { id1: '', id2: 'valid' }],
    ['blank field', { id1: ' \n\t', id2: 'valid' }],
    ['oversized field', { id1: 'x'.repeat(256), id2: 'valid' }],
    ['oversized astral field', { id1: '😀'.repeat(256), id2: 'valid' }],
    [
      'oversized presentation sequence',
      { id1: 'a\uFE0F'.repeat(128), id2: 'valid' },
    ],
    ['lone surrogate', { id1: '\ud800', id2: 'valid' }],
    ['array body', []],
    ['null body', null],
    ['scalar body', true],
  ])('rejects %s input without inserting records', async (_name, body) => {
    const before = await fixture.database
      .getRepository(IdentityMapping)
      .count();
    const response = await fixture.post(app, body);
    expect(response.status).toBe(400);
    expect(await fixture.database.getRepository(IdentityMapping).count()).toBe(
      before,
    );
  });

  it.each([
    'extra',
    ...Object.getOwnPropertyNames(Object.prototype),
    'prototype',
  ])(
    'rejects the unsupported %s property without reflecting its name or value',
    async (name) => {
      const pair = fixture.pair(`unsupported-${name}`);
      const body = JSON.parse(
        JSON.stringify(pair).slice(0, -1) +
          `,"${name}":"sensitive-test-marker"}`,
      ) as unknown;
      const response = await fixture.post(app, body);
      expect(response.status).toBe(400);
      expect(response.text).not.toContain('sensitive-test-marker');
      expect(await stored(pair)).toEqual([]);
    },
  );

  it.each(['😀'.repeat(255), '界'.repeat(255), 'a\uFE0F'.repeat(127) + 'a'])(
    'preserves a full-length Unicode identifier',
    async (identifier) => {
      const pair = fixture.track({ id1: identifier, id2: fixture.prefix });
      const id = userID(await fixture.post(app, pair));
      expect(userID(await fixture.post(other, pair))).toBe(id);
      expect(await stored(pair)).toEqual([{ ...pair, userID: id }]);
    },
  );

  it('preserves case, whitespace, normalization, pair order and delimiters', async () => {
    const pairs = [
      ...['Case', 'case', 'Case ', ' Case', 'é', 'e\u0301'].map((value) =>
        fixture.track({ id1: `${fixture.prefix}:${value}`, id2: 'exact' }),
      ),
      fixture.track({ id1: `${fixture.prefix}:a:b`, id2: 'c' }),
      fixture.track({ id1: `${fixture.prefix}:a`, id2: 'b:c' }),
      fixture.track({
        id1: `${fixture.prefix}:left`,
        id2: `${fixture.prefix}:right`,
      }),
      fixture.track({
        id1: `${fixture.prefix}:right`,
        id2: `${fixture.prefix}:left`,
      }),
    ];
    const ids = new Set<string>();

    for (const pair of pairs) {
      const id = userID(await fixture.post(app, pair));
      ids.add(id);
      expect(userID(await fixture.post(other, pair))).toBe(id);
    }

    expect(ids.size).toBe(pairs.length);
  });

  it('treats quoted identifier text as data', async () => {
    const pair = fixture.track({
      id1: `${fixture.prefix}'); SELECT 'quoted-value`,
      id2: 'quoted\\value',
    });
    const id = userID(await fixture.post(app, pair));
    expect(await stored(pair)).toEqual([{ ...pair, userID: id }]);
  });

  it('returns a fixed error for malformed JSON and oversized bodies', async () => {
    const malformed = await request(app.getHttpServer())
      .post('/users/resolve')
      .set('Content-Type', 'application/json')
      .send('{"id1":"sensitive-test-marker"');
    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Invalid request body',
    });
    expect(malformed.text).not.toContain('sensitive-test-marker');
    const oversized = await fixture.post(app, {
      id1: 'x'.repeat(110000),
      id2: 'x',
    });
    expect(oversized.status).toBe(413);
    expect(oversized.body).toEqual({
      statusCode: 413,
      error: 'Payload Too Large',
      message: 'Payload Too Large',
    });
  });

  it('serves a confirmed cache hit without a repository lookup', async () => {
    const pair = fixture.pair('cache-hit');
    const id = await warm(pair);
    const lookup = jest
      .spyOn(app.get(IdentityRepository), 'findByPair')
      .mockRejectedValue(new Error('repository-test-failure'));
    expect(userID(await fixture.post(app, pair))).toBe(id);
    expect(lookup).not.toHaveBeenCalled();
    const ttl = await fixture.redis.ttl(fixture.cacheKey(pair));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
  });

  it('repairs invalid Redis data from MySQL', async () => {
    const pair = fixture.pair('invalid-cache');
    const id = await warm(pair);
    await fixture.redis.set(fixture.cacheKey(pair), 'invalid-test-value');
    expect(userID(await fixture.post(app, pair))).toBe(id);
    expect(await fixture.redis.get(fixture.cacheKey(pair))).toBe(id);
  });

  it('rebuilds an expired cache entry without changing the database ID', async () => {
    const expiring = await fixture.createApp({ REDIS_TTL_SECONDS: 1 });
    const pair = fixture.pair('expiry');
    const id = userID(await fixture.post(expiring, pair));
    await fixture.waitFor(async () => {
      await fixture.post(expiring, pair);
      return (await fixture.redis.get(fixture.cacheKey(pair))) === id;
    }, 'the expiring cache entry');
    await fixture.waitFor(
      async () => (await fixture.redis.get(fixture.cacheKey(pair))) === null,
      'cache expiration',
    );
    expect(userID(await fixture.post(expiring, pair))).toBe(id);
    expect(await stored(pair)).toEqual([{ ...pair, userID: id }]);
    await fixture.closeApp(expiring);
  });

  it('runs against MySQL when Redis is disabled or unreachable', async () => {
    const pair = fixture.pair('cache-fallback');
    const id = userID(await fixture.post(app, pair));
    const disabled = await fixture.createApp({ REDIS_ENABLED: false });
    const unavailable = await fixture.createApp({
      REDIS_PORT: await unusedPort(),
    });
    expect(userID(await fixture.post(disabled, pair))).toBe(id);
    expect(userID(await fixture.post(unavailable, pair))).toBe(id);
    await fixture.closeApp(disabled);
    await fixture.closeApp(unavailable);
  });

  it('keeps application overrides inside the guarded test database', async () => {
    const overrides = {
      REDIS_ENABLED: false,
      MYSQL_DATABASE: 'mediconcen_unrelated',
    };
    const guarded = await fixture.createApp(overrides);
    const config = guarded.get<ConfigService<Environment, true>>(ConfigService);
    expect(config.get('MYSQL_DATABASE', { infer: true })).toBe(
      fixture.environment.MYSQL_DATABASE,
    );
    const pair = fixture.pair('guarded-overrides');
    const id = userID(await fixture.post(guarded, pair));
    expect(await stored(pair)).toEqual([{ ...pair, userID: id }]);
    await fixture.closeApp(guarded);
  });

  it.each([
    ['ECONNREFUSED', 503, 'Service temporarily unavailable'],
    ['ER_NO_SUCH_TABLE', 500, 'Internal server error'],
  ])(
    'sanitizes an injected %s repository failure and keeps serving',
    async (code, status, message) => {
      const pair = fixture.pair(`failure-${code}`);
      const failure = new QueryFailedError(
        'SELECT sensitive-test-marker',
        ['sensitive-test-marker'],
        Object.assign(new Error('sensitive-test-marker'), { code }),
      );
      const lookup = jest
        .spyOn(app.get(IdentityRepository), 'findByPair')
        .mockRejectedValueOnce(failure);
      const response = await fixture.post(app, pair);
      expect(response.status).toBe(status);
      expect(response.body).toEqual({
        statusCode: status,
        error: status === 503 ? 'Service Unavailable' : 'Internal Server Error',
        message,
      });
      expect(response.text).not.toContain('sensitive-test-marker');
      lookup.mockRestore();
      userID(await fixture.post(app, pair));
    },
  );

  it('preserves the UUID after an application restart', async () => {
    const pair = fixture.pair('restart');
    const id = userID(await fixture.post(app, pair));
    await fixture.closeApp(app);
    app = await fixture.createApp();
    await fixture.redis.del(fixture.cacheKey(pair));
    expect(userID(await fixture.post(app, pair))).toBe(id);
  });
});
