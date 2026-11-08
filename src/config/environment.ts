export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  MYSQL_HOST: string;
  MYSQL_PORT: number;
  MYSQL_DATABASE: string;
  MYSQL_USER: string;
  MYSQL_PASSWORD: string;
  REDIS_ENABLED: boolean;
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_USERNAME: string;
  REDIS_PASSWORD: string;
  REDIS_TTL_SECONDS: number;
  REDIS_TIMEOUT_MS: number;
}

function readInteger(
  value: unknown,
  name: string,
  defaultValue: number,
  maximum: number,
): number {
  const rawValue = value ?? String(defaultValue);

  if (typeof rawValue !== 'string' || !/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }

  const parsed = Number(rawValue);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }

  return parsed;
}

function readRequiredString(
  config: Record<string, unknown>,
  name: string,
  defaultValue?: string,
): string {
  const rawValue = config[name] ?? defaultValue;

  if (typeof rawValue !== 'string') {
    throw new Error(`${name} must be a non-empty string`);
  }

  const value = name === 'MYSQL_PASSWORD' ? rawValue : rawValue.trim();

  if (value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value;
}

function readOptionalString(value: unknown, name: string): string {
  const parsed = value ?? '';

  if (typeof parsed !== 'string') {
    throw new Error(`${name} must be a string`);
  }

  return parsed;
}

function readBoolean(
  value: unknown,
  name: string,
  defaultValue: boolean,
): boolean {
  const parsed = value ?? String(defaultValue);

  if (parsed !== 'true' && parsed !== 'false') {
    throw new Error(`${name} must be true or false`);
  }

  return parsed === 'true';
}

export function validateEnvironment(
  config: Record<string, unknown>,
): Environment {
  const nodeEnv = config.NODE_ENV ?? 'development';

  if (
    nodeEnv !== 'development' &&
    nodeEnv !== 'test' &&
    nodeEnv !== 'production'
  ) {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  return {
    NODE_ENV: nodeEnv,
    PORT: readInteger(config.PORT, 'PORT', 3000, 65535),
    MYSQL_HOST: readRequiredString(config, 'MYSQL_HOST'),
    MYSQL_PORT: readInteger(config.MYSQL_PORT, 'MYSQL_PORT', 3306, 65535),
    MYSQL_DATABASE: readRequiredString(config, 'MYSQL_DATABASE'),
    MYSQL_USER: readRequiredString(config, 'MYSQL_USER'),
    MYSQL_PASSWORD: readRequiredString(config, 'MYSQL_PASSWORD'),
    REDIS_ENABLED: readBoolean(config.REDIS_ENABLED, 'REDIS_ENABLED', true),
    REDIS_HOST: readRequiredString(config, 'REDIS_HOST', '127.0.0.1'),
    REDIS_PORT: readInteger(config.REDIS_PORT, 'REDIS_PORT', 6379, 65535),
    REDIS_USERNAME: readOptionalString(config.REDIS_USERNAME, 'REDIS_USERNAME'),
    REDIS_PASSWORD: readOptionalString(config.REDIS_PASSWORD, 'REDIS_PASSWORD'),
    REDIS_TTL_SECONDS: readInteger(
      config.REDIS_TTL_SECONDS,
      'REDIS_TTL_SECONDS',
      300,
      86400,
    ),
    REDIS_TIMEOUT_MS: readInteger(
      config.REDIS_TIMEOUT_MS,
      'REDIS_TIMEOUT_MS',
      200,
      5000,
    ),
  };
}
