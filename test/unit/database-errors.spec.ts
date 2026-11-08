import { QueryFailedError } from 'typeorm';
import {
  isDatabaseUnavailableError,
  isDuplicateKeyError,
} from '../../src/database/database-errors';

function driverError(code: string): Error & { code: string } {
  return Object.assign(new Error('Database driver failure'), { code });
}

function queryError(code: string): QueryFailedError {
  return new QueryFailedError(
    'SELECT userID FROM identity_mappings',
    [],
    driverError(code),
  );
}

describe('Database error classification', () => {
  it('recognizes duplicate keys only when wrapped by TypeORM', () => {
    expect(isDuplicateKeyError(queryError('ER_DUP_ENTRY'))).toBe(true);
    expect(isDuplicateKeyError(driverError('ER_DUP_ENTRY'))).toBe(false);
    expect(isDuplicateKeyError({ code: 'ER_DUP_ENTRY' })).toBe(false);
    expect(isDuplicateKeyError(queryError('ER_BAD_FIELD_ERROR'))).toBe(false);
  });

  it.each([
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
    'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
    'ER_CON_COUNT_ERROR',
    'ER_TOO_MANY_USER_CONNECTIONS',
    'ER_SERVER_SHUTDOWN',
    'ER_LOCK_WAIT_TIMEOUT',
    'ER_LOCK_DEADLOCK',
  ])(
    'recognizes transient %s errors before and after TypeORM wrapping',
    (code) => {
      expect(isDatabaseUnavailableError(driverError(code))).toBe(true);
      expect(isDatabaseUnavailableError(queryError(code))).toBe(true);
      expect(isDuplicateKeyError(queryError(code))).toBe(false);
    },
  );

  it.each([
    'ER_DUP_ENTRY',
    'ER_BAD_FIELD_ERROR',
    'ER_ACCESS_DENIED_ERROR',
    'UNKNOWN_ERROR',
  ])('does not misclassify %s as a transient outage', (code) => {
    expect(isDatabaseUnavailableError(driverError(code))).toBe(false);
    expect(isDatabaseUnavailableError(queryError(code))).toBe(false);
  });

  it.each([null, undefined, 'ECONNREFUSED', 503, {}, { code: 503 }])(
    'safely rejects malformed error values',
    (error) => {
      expect(isDatabaseUnavailableError(error)).toBe(false);
      expect(isDuplicateKeyError(error)).toBe(false);
    },
  );
});
