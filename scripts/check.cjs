const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const app = path.join(root, 'doctor-chess-site');
for (const file of fs.readdirSync(path.join(app, 'dist')).filter((file) => file.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', path.join(app, 'dist', file)], {
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
const ui = spawnSync(process.execPath, [path.join(__dirname, 'check-ui.cjs')], {
  stdio: 'inherit',
});
if (ui.status !== 0) process.exit(ui.status || 1);
const checks = [
  'test-engine.cjs',
  'test-study.cjs',
  'test-client.cjs',
  'test-room.cjs',
  'test-live.cjs',
  'test-doctor.cjs',
];
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
