// jest.config.js
// Default (stub) test config. Explicitly restricts test discovery to *.test.js /
// *.spec.js (so non-test helpers like __tests__/live/_liveEnv.js are NOT picked
// up as empty suites) and IGNORES the gated live suite under __tests__/live/.
// The live suite runs opt-in via `npm run test:live` (jest.live.config.js),
// which only executes with SOROBAN_ADAPTER=real + creds + network.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/live/'],
  // `--detectOpenHandles` reports ZERO leaked JS handles; the "did not exit"
  // notice comes from mongodb-memory-server's native `mongod` child processes
  // (which detectOpenHandles can't see) being reaped a beat after the run. Force
  // a clean exit so CI doesn't hang on that teardown latency.
  forceExit: true,
};
