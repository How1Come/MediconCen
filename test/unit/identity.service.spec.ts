import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { QueryFailedError } from 'typeorm';
import { IdentityCache } from '../../src/cache/identity-cache.service';
import { IdentityRepository } from '../../src/identity/identity.repository';
import { IdentityService } from '../../src/identity/identity.service';

type RepositoryFake = jest.Mocked<
  Pick<IdentityRepository, 'findByPair' | 'insert'>
>;
type CacheFake = jest.Mocked<Pick<IdentityCache, 'get' | 'set'>>;

function duplicateError(): QueryFailedError {
  return new QueryFailedError(
    'INSERT INTO identity_mappings',
    [],
    Object.assign(new Error('Duplicate key'), { code: 'ER_DUP_ENTRY' }),
  );
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });

  return { promise, resolve };
}

describe('IdentityService', () => {
  let identities: RepositoryFake;
  let cache: CacheFake;
  let service: IdentityService;

  beforeEach(() => {
    identities = {
      findByPair: jest.fn(),
      insert: jest.fn(),
    };
    identities.findByPair.mockResolvedValue(null);
    identities.insert.mockResolvedValue(undefined);
    cache = {
      get: jest.fn(),
      set: jest.fn(),
    };
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue(undefined);
    service = new IdentityService(
      identities as unknown as IdentityRepository,
      cache as unknown as IdentityCache,
    );
  });

  it('returns a cached UUID without querying MySQL or rewriting the cache', async () => {
    const userID = randomUUID();
    cache.get.mockResolvedValue(userID);

    await expect(service.resolve('ABC123', 'XYZ456')).resolves.toEqual({
      userID,
    });

    expect(cache.get).toHaveBeenCalledWith('ABC123', 'XYZ456');
    expect(identities.findByPair).not.toHaveBeenCalled();
    expect(identities.insert).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('returns and caches an existing database mapping without inserting', async () => {
    const userID = randomUUID();
    identities.findByPair.mockResolvedValue({
      id1: ' ABC123 ',
      id2: 'XYZ456',
      userID,
    });

    await expect(service.resolve(' ABC123 ', 'XYZ456')).resolves.toEqual({
      userID,
    });

    expect(identities.findByPair).toHaveBeenCalledWith(' ABC123 ', 'XYZ456');
    expect(identities.insert).not.toHaveBeenCalled();
    expect(cache.set).toHaveBeenCalledWith(' ABC123 ', 'XYZ456', userID);
  });

  it('persists a new UUID v4 and returns the persisted value', async () => {
    const response = await service.resolve('ABC123', 'XYZ456');

    expect(response.userID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(identities.insert).toHaveBeenCalledTimes(1);
    expect(identities.insert).toHaveBeenCalledWith({
      id1: 'ABC123',
      id2: 'XYZ456',
      userID: response.userID,
    });
    expect(cache.set).toHaveBeenCalledWith('ABC123', 'XYZ456', response.userID);
    expect(Object.keys(response)).toEqual(['userID']);
  });

  it('does not return or populate Redis before the insert completes', async () => {
    const entered = deferred();
    const inserted = deferred();
    identities.insert.mockImplementation(async () => {
      entered.resolve();
      await inserted.promise;
    });
    let settled = false;
    const response = service.resolve('ABC123', 'XYZ456').then((value) => {
      settled = true;
      return value;
    });

    await entered.promise;

    try {
      expect(settled).toBe(false);
      expect(cache.set).not.toHaveBeenCalled();
    } finally {
      inserted.resolve();
    }

    const result = await response;
    expect(cache.set).toHaveBeenCalledWith('ABC123', 'XYZ456', result.userID);
  });

  it('returns and caches the competing insert winner instead of the tentative UUID', async () => {
    const userID = randomUUID();
    identities.findByPair
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id1: 'ABC123', id2: 'XYZ456', userID });
    identities.insert.mockRejectedValue(duplicateError());

    await expect(service.resolve('ABC123', 'XYZ456')).resolves.toEqual({
      userID,
    });

    expect(identities.findByPair).toHaveBeenCalledTimes(2);
    expect(identities.findByPair).toHaveBeenNthCalledWith(
      2,
      'ABC123',
      'XYZ456',
    );
    expect(identities.insert).toHaveBeenCalledTimes(1);
    expect(identities.insert.mock.calls[0]?.[0].userID).not.toBe(userID);
    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith('ABC123', 'XYZ456', userID);
  });

  it('rethrows a duplicate-key error when no matching pair can be recovered', async () => {
    const error = duplicateError();
    identities.insert.mockRejectedValue(error);

    await expect(service.resolve('ABC123', 'XYZ456')).rejects.toBe(error);

    expect(identities.findByPair).toHaveBeenCalledTimes(2);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('propagates a failed winner lookup without caching a tentative UUID', async () => {
    const error = new Error('Winner lookup failed');
    identities.findByPair
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(error);
    identities.insert.mockRejectedValue(duplicateError());

    await expect(service.resolve('ABC123', 'XYZ456')).rejects.toBe(error);

    expect(cache.set).not.toHaveBeenCalled();
  });

  it('propagates lookup failures without inserting or populating the cache', async () => {
    const error = new Error('Database lookup failed');
    identities.findByPair.mockRejectedValue(error);

    await expect(service.resolve('ABC123', 'XYZ456')).rejects.toBe(error);

    expect(identities.insert).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it.each([
    ['an ordinary insert failure', new Error('Database insert failed')],
    [
      'a raw error claiming to be a duplicate',
      Object.assign(new Error('Unwrapped failure'), { code: 'ER_DUP_ENTRY' }),
    ],
    ['a plain object claiming to be a duplicate', { code: 'ER_DUP_ENTRY' }],
  ])(
    'propagates %s without a winner lookup or cache write',
    async (_, error) => {
      identities.insert.mockRejectedValue(error);

      await expect(service.resolve('ABC123', 'XYZ456')).rejects.toBe(error);

      expect(identities.findByPair).toHaveBeenCalledTimes(1);
      expect(cache.set).not.toHaveBeenCalled();
    },
  );
});
