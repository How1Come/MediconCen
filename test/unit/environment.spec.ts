import { randomBytes } from 'node:crypto';
import { validateEnvironment } from '../../src/config/environment';

function requiredSettings(): Record<string, unknown> {
  return {
    MYSQL_HOST: '127.0.0.1',
    MYSQL_DATABASE: 'test_database',
    MYSQL_USER: 'test_user',
    MYSQL_PASSWORD: randomBytes(24).toString('hex'),
  };
}

describe('Environment configuration', () => {
  it('provides application and cache defaults without inventing database credentials', () => {
    const settings = requiredSettings();

    expect(validateEnvironment(settings)).toEqual({
      ...settings,
      NODE_ENV: 'development',
      PORT: 3000,
      MYSQL_PORT: 3306,
      REDIS_ENABLED: true,
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: 6379,
      REDIS_USERNAME: '',
      REDIS_PASSWORD: '',
      REDIS_TTL_SECONDS: 300,
      REDIS_TIMEOUT_MS: 200,
    });
  });

  it.each(['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'])(
    'requires %s rather than inventing a default',
    (field) => {
      const settings = requiredSettings();
      delete settings[field];

      expect(() => validateEnvironment(settings)).toThrow(field);
      expect(() => validateEnvironment({ ...settings, [field]: '' })).toThrow(
        field,
      );
    },
  );

  it('preserves password bytes and optional Redis credentials', () => {
    const mysqlPassword = `  ${randomBytes(24).toString('base64')}  `;
    const redisPassword = `\t${randomBytes(24).toString('base64')} `;
    const redisUsername = ' cache user ';
    const result = validateEnvironment({
      ...requiredSettings(),
      MYSQL_PASSWORD: mysqlPassword,
      REDIS_PASSWORD: redisPassword,
      REDIS_USERNAME: redisUsername,
    });

    expect(result.MYSQL_PASSWORD).toBe(mysqlPassword);
    expect(result.REDIS_PASSWORD).toBe(redisPassword);
    expect(result.REDIS_USERNAME).toBe(redisUsername);
  });

  it.each([
    { field: 'PORT', maximum: 65535 },
    { field: 'MYSQL_PORT', maximum: 65535 },
    { field: 'REDIS_PORT', maximum: 65535 },
    { field: 'REDIS_TTL_SECONDS', maximum: 86400 },
    { field: 'REDIS_TIMEOUT_MS', maximum: 5000 },
  ])('enforces the documented bounds for $field', ({ field, maximum }) => {
    const settings = requiredSettings();

    expect(validateEnvironment({ ...settings, [field]: '1' })).toHaveProperty(
      field,
      1,
    );
    expect(
      validateEnvironment({ ...settings, [field]: String(maximum) }),
    ).toHaveProperty(field, maximum);
    expect(() => validateEnvironment({ ...settings, [field]: '0' })).toThrow(
      field,
    );
    expect(() =>
      validateEnvironment({ ...settings, [field]: String(maximum + 1) }),
    ).toThrow(field);
  });

  it.each(['3.5', '3306suffix', '1e2', ' 3306 ', 3306])(
    'rejects non-integer-string port configuration',
    (value) => {
      expect(() =>
        validateEnvironment({ ...requiredSettings(), MYSQL_PORT: value }),
      ).toThrow('MYSQL_PORT');
    },
  );

  it('accepts explicit true and false Redis flags', () => {
    const settings = requiredSettings();

    expect(
      validateEnvironment({ ...settings, REDIS_ENABLED: 'true' }).REDIS_ENABLED,
    ).toBe(true);
    expect(
      validateEnvironment({ ...settings, REDIS_ENABLED: 'false' })
        .REDIS_ENABLED,
    ).toBe(false);
  });

  it.each(['TRUE', '1', 'yes', '', true, false])(
    'rejects Redis flags outside the exact environment-string contract',
    (value) => {
      expect(() =>
        validateEnvironment({ ...requiredSettings(), REDIS_ENABLED: value }),
      ).toThrow('REDIS_ENABLED');
    },
  );

  it('validates Redis settings even when caching is disabled', () => {
    expect(() =>
      validateEnvironment({
        ...requiredSettings(),
        REDIS_ENABLED: 'false',
        REDIS_HOST: '   ',
      }),
    ).toThrow('REDIS_HOST');
  });

  it('accepts production mode and rejects unsupported environment names', () => {
    const settings = requiredSettings();

    expect(
      validateEnvironment({ ...settings, NODE_ENV: 'production' }).NODE_ENV,
    ).toBe('production');
    expect(() =>
      validateEnvironment({ ...settings, NODE_ENV: 'staging' }),
    ).toThrow('NODE_ENV');
  });

  it('reports invalid credential configuration without echoing supplied values', () => {
    const supplied = randomBytes(24).toString('hex');
    const validate = (): void => {
      validateEnvironment({
        ...requiredSettings(),
        REDIS_PASSWORD: { value: supplied },
      });
    };

    expect(validate).toThrow('REDIS_PASSWORD must be a string');
    expect(validate).not.toThrow(supplied);
  });
});
