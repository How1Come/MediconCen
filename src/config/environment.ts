export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  MYSQL_HOST: string;
  MYSQL_PORT: number;
  MYSQL_DATABASE: string;
  MYSQL_USER: string;
  MYSQL_PASSWORD: string;
}

function readPort(value: unknown, name: string, defaultPort: number): number {
  const rawPort = value ?? String(defaultPort);

  if (typeof rawPort !== 'string' || !/^\d+$/.test(rawPort)) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  return port;
}

function readRequiredString(
  config: Record<string, unknown>,
  name: string,
): string {
  const rawValue = config[name];

  if (typeof rawValue !== 'string') {
    throw new Error(`${name} must be a non-empty string`);
  }

  const value = name === 'MYSQL_PASSWORD' ? rawValue : rawValue.trim();

  if (value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value;
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
    PORT: readPort(config.PORT, 'PORT', 3000),
    MYSQL_HOST: readRequiredString(config, 'MYSQL_HOST'),
    MYSQL_PORT: readPort(config.MYSQL_PORT, 'MYSQL_PORT', 3306),
    MYSQL_DATABASE: readRequiredString(config, 'MYSQL_DATABASE'),
    MYSQL_USER: readRequiredString(config, 'MYSQL_USER'),
    MYSQL_PASSWORD: readRequiredString(config, 'MYSQL_PASSWORD'),
  };
}
