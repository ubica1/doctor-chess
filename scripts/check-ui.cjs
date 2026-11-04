const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dist = path.resolve(__dirname, '../doctor-chess-site/dist');
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const ids = [...html.matchAll(/\bid\s*=\s*["']([\w-]+)["']/g)].map((m) => m[1]);
assert.equal(new Set(ids).size, ids.length, 'Static HTML IDs must be unique');
const available = new Set(ids);
const sources = fs
  .readdirSync(dist)
  .filter((file) => file.endsWith('.js'))
  .map((file) => fs.readFileSync(path.join(dist, file), 'utf8'));
for (const source of sources)
  for (const m of source.matchAll(/\bid\s*=\s*["']([\w-]+)["']/g)) available.add(m[1]);
for (const source of sources)
  for (const m of source.matchAll(/\$\(\s*["']([\w-]+)["']\s*\)/g))
    assert(available.has(m[1]), 'Referenced UI element is missing: ' + m[1]);
for (const m of html.matchAll(/(?:src|href)="(\/(?:[\w-]+\.(?:js|css|svg)))(?:\?[^" ]*)?"/g))
  assert(fs.existsSync(path.join(dist, m[1].slice(1))), 'Missing local asset: ' + m[1]);
console.log('PASS: unique UI IDs, static/dynamic controls and local assets');
