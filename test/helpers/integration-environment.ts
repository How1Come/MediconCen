import { validateEnvironment } from '../../src/config/environment';
import type { Environment } from '../../src/config/environment';

export function integrationEnvironment(input: NodeJS.ProcessEnv): Environment {
  const database = input.TEST_MYSQL_DATABASE;

  if (
    database === undefined ||
    database.length > 64 ||
    !/^mediconcen_test(?:_[a-z0-9]+)*$/.test(database)
  ) {
    throw new Error(
      'TEST_MYSQL_DATABASE must be a dedicated mediconcen_test database',
    );
  }

  if (!input.TEST_MYSQL_USER?.trim()) {
    throw new Error('TEST_MYSQL_USER is required');
  }

  if (!input.TEST_MYSQL_PASSWORD) {
    throw new Error('TEST_MYSQL_PASSWORD is required');
  }

  return validateEnvironment({
    NODE_ENV: 'test',
    MYSQL_HOST: input.TEST_MYSQL_HOST ?? '127.0.0.1',
    MYSQL_PORT: input.TEST_MYSQL_PORT ?? '3306',
    MYSQL_DATABASE: database,
    MYSQL_USER: input.TEST_MYSQL_USER,
    MYSQL_PASSWORD: input.TEST_MYSQL_PASSWORD,
    REDIS_ENABLED: 'true',
    REDIS_HOST: input.TEST_REDIS_HOST ?? '127.0.0.1',
    REDIS_PORT: input.TEST_REDIS_PORT ?? '6379',
    REDIS_USERNAME: input.TEST_REDIS_USERNAME ?? '',
    REDIS_PASSWORD: input.TEST_REDIS_PASSWORD ?? '',
    REDIS_TTL_SECONDS: '30',
    REDIS_TIMEOUT_MS: '200',
  });
}
