import { QueryFailedError } from 'typeorm';

const unavailableCodes = new Set([
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
]);

function databaseErrorCode(error: unknown): string | undefined {
  const cause: unknown =
    error instanceof QueryFailedError ? error.driverError : error;

  if (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    typeof cause.code === 'string'
  ) {
    return cause.code;
  }

  return undefined;
}

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    databaseErrorCode(error) === 'ER_DUP_ENTRY'
  );
}

export function isDatabaseUnavailableError(error: unknown): boolean {
  const code = databaseErrorCode(error);

  return code !== undefined && unavailableCodes.has(code);
}
