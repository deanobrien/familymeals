module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  // __tests__/live needs the local Supabase stack and plain Node: it runs through vitest (pnpm test:live), not jest.
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/__tests__/helpers/', '/__tests__/live/'],
};
