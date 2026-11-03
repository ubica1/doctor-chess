const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const app = path.join(root, 'doctor-chess-site');
const checks = ['test-engine.cjs', 'test-study.cjs', 'test-client.cjs'];
for (const file of checks) {
  const result = spawnSync(process.execPath, [file], { cwd: app, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
const result = spawnSync(process.env.PYTHON || 'python', ['-m', 'unittest', 'test_server', '-v'], {
  cwd: app,
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status || 1);
console.log('All Doctor Chess checks passed.');
