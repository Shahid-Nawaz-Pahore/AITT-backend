// jest.live.config.js
// Opt-in LIVE suite config — runs ONLY the gated tests under __tests__/live/
// against the deployed contract. Invoked by `npm run test:live`, which sets
// SOROBAN_ADAPTER=real; without that env the suites self-skip (see _liveEnv.js).
// The _liveEnv.js helper is excluded by the *.test.js testMatch.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/live/**/*.+(test).[jt]s?(x)'],
  testPathIgnorePatterns: ['/node_modules/'],
  // Live txs confirm in seconds; give the whole suite room.
  testTimeout: 180000,
};
