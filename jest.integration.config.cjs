module.exports = {
  ...require('./jest.config.cjs'),
  testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
  testTimeout: 15000,
  coverageDirectory: '<rootDir>/coverage/integration',
};
