'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const wb = require('../../worldbisect.cjs');

const repo = path.resolve(process.argv[2] || '');
if (!repo) throw new Error('usage: node reproduce.cjs <dotenv-checkout-at-560df15>');
const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
const expectedCommit = '560df1555e7fb5cfe7254942e4dc54a16a3316f3';
assert.equal(commit, expectedCommit, 'checkout must be dotenv v16.0.3 at the pinned commit');
const source = new Map();
for (const name of ['lib/main.js', 'package.json']) {
  const bytes = fs.readFileSync(path.join(repo, name));
  source.set(name.toLowerCase(), {name, bytes, hash: wb.sha(bytes)});
}
const makeWorld = (username, noise, envText) => ({
  commit,
  env: wb.envMap({USERNAME: username, ...Object.fromEntries(noise.map((value, index) => [`WB_NOISE_${index}`, value]))}),
  source: new Map(source),
  world: new Map([['.env', {name: '.env', bytes: Buffer.from(envText), hash: wb.sha(Buffer.from(envText))}]]),
});
const a = makeWorld('something', ['x', 'x', 'x', 'x'], 'USERNAME=something\n');
const b = makeWorld('WINDOWS_ACCOUNT_FIXTURE', ['y', 'y', 'y', 'y'], 'USERNAME=something\n');

async function main() {
  const report = await wb.minimize(a, b, {
    command: [process.execPath, path.join(__dirname, 'dotenv-predicate.cjs')],
    repeat: 3,
  });
  assert.equal(report.status, 'PASS', report.reason);
  assert.deepEqual(report.minimalCause, ['ENV:USERNAME']);
  assert.equal(report.items.length, 5);
  assert.equal(report.predicateRuns, 30);
  assert.equal(report.residualReproduces, false);
  const items = wb.diffWorlds(a, b);
  const cause = items.findIndex(item => item.id === 'ENV:USERNAME');
  const oracle = new wb.Oracle(a, b, items, {command: [process.execPath, path.join(__dirname, 'dotenv-predicate.cjs')], repeat: 3});
  assert.equal(await oracle.test([cause], {fresh: true, label: 'public fresh cause'}), 'FAIL');
  assert.equal(await oracle.test(items.map((_, index) => index).filter(index => index !== cause), {fresh: true, label: 'public fresh removal'}), 'PASS');
  console.log(JSON.stringify({status: report.status, candidates: report.items.map(item => item.id), minimalCause: report.minimalCause, predicateRuns: report.predicateRuns, residualReproduces: report.residualReproduces, freshCause: 'FAIL', freshWithoutCause: 'PASS'}, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
