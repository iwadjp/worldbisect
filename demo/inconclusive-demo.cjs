'use strict';
const assert = require('node:assert/strict');
const wb = require('../worldbisect.cjs');

const bytes = Buffer.from('negative fixture\n');
const world = env => ({
  commit: 'c'.repeat(40),
  env: wb.envMap(env),
  source: new Map([['fixture.txt', {name: 'fixture.txt', bytes, hash: wb.sha(bytes)}]]),
  world: new Map(),
});

async function main() {
  const report = await wb.minimize(world({USERNAME: 'WORLD_A_FIXTURE'}), world({USERNAME: null}), {
    command: [process.execPath, '-e', "console.error('WORLDBISECT:FAIL:should-not-run');process.exitCode=1"],
    repeat: 2,
  });
  if (process.platform === 'win32' && Object.hasOwn(process.env, 'USERNAME')) {
    assert.equal(report.status, 'INCONCLUSIVE');
    assert.equal(report.minimalCause, null);
  }
  console.log(JSON.stringify({status: report.status, minimalCause: report.minimalCause, note: 'An effective-env mismatch must not become a cause.'}, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
