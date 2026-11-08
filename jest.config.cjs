module.exports = {
  testEnvironment: 'node',
  watchman: false,
  testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFiles: ['<rootDir>/test/setup.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/test/tsconfig.json' }],
  },
  clearMocks: true,
  restoreMocks: true,
  cacheDirectory: '<rootDir>/node_modules/.cache/jest',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main.ts',
    '!src/database/data-source.ts',
    '!src/database/migrations/**',
  ],
  coverageDirectory: '<rootDir>/coverage/unit',
};
