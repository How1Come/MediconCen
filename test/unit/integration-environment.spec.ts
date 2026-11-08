import { randomUUID } from 'node:crypto';
import { integrationEnvironment } from '../helpers/integration-environment';

const configuration = {
  TEST_MYSQL_DATABASE: 'mediconcen_test',
  TEST_MYSQL_USER: 'mediconcen_test',
  TEST_MYSQL_PASSWORD: randomUUID(),
};

describe('Integration environment isolation', () => {
  it.each(['mediconcen', 'production', '', 'mediconcen_test;DROP DATABASE x'])(
    'rejects an unsafe database name: %s',
    (database) => {
      expect(() =>
        integrationEnvironment({
          ...configuration,
          TEST_MYSQL_DATABASE: database,
        }),
      ).toThrow('TEST_MYSQL_DATABASE');
    },
  );

  it('does not fall back to application credentials', () => {
    expect(() =>
      integrationEnvironment({
        MYSQL_DATABASE: 'mediconcen',
        MYSQL_USER: 'application',
        MYSQL_PASSWORD: randomUUID(),
      }),
    ).toThrow('TEST_MYSQL_DATABASE');
  });

  it('requires explicit test credentials', () => {
    expect(() =>
      integrationEnvironment({ ...configuration, TEST_MYSQL_USER: '' }),
    ).toThrow('TEST_MYSQL_USER');
    expect(() =>
      integrationEnvironment({ ...configuration, TEST_MYSQL_PASSWORD: '' }),
    ).toThrow('TEST_MYSQL_PASSWORD');
  });

  it('accepts a dedicated database and preserves its password', () => {
    const password = ` ${randomUUID()}# `;
    const environment = integrationEnvironment({
      ...configuration,
      TEST_MYSQL_DATABASE: 'mediconcen_test_ci_123',
      TEST_MYSQL_PASSWORD: password,
    });

    expect(environment.MYSQL_DATABASE).toBe('mediconcen_test_ci_123');
    expect(environment.MYSQL_PASSWORD).toBe(password);
    expect(environment.NODE_ENV).toBe('test');
  });
});
