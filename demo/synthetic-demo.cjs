'use strict';
const assert = require('node:assert/strict');
const wb = require('../worldbisect.cjs');

const sourceBytes = Buffer.from('synthetic source fixture\n');
const file = (name, text) => ({name, bytes: Buffer.from(text), hash: wb.sha(Buffer.from(text))});
const world = (env, files) => ({
  commit: 'b'.repeat(40),
  env: wb.envMap(env),
  source: new Map([['fixture.txt', {name: 'fixture.txt', bytes: sourceBytes, hash: wb.sha(sourceBytes)}]]),
  world: new Map(files.map(([name, text]) => [name.toLowerCase(), file(name, text)])),
});

async function main() {
  const a = world({WB_MODE: 'good', WB_UNUSED: 'same'}, [
    ['.gitignore', 'cache/\n'],
    ['.cache/harmless.json', '{"state":"same"}\n'],
  ]);
  const b = world({WB_MODE: 'bad', WB_UNUSED: 'different'}, [
    ['.gitignore', 'cache/\n# local note\n'],
    ['.cache/harmless.json', '{"state":"different"}\n'],
  ]);
  const report = await wb.minimize(a, b, {
    command: [process.execPath, '-e', "if(process.env.WB_MODE==='bad'){console.error('WORLDBISECT:FAIL:synthetic-mode');process.exitCode=1;}"] ,
    repeat: 2,
  });
  assert.equal(report.status, 'PASS', report.reason);
  assert.deepEqual(report.minimalCause, ['ENV:WB_MODE']);
  assert.equal(report.residualReproduces, false);
  console.log(JSON.stringify({
    status: report.status,
    candidates: report.items.map(item => item.id),
    minimalCause: report.minimalCause,
    predicateRuns: report.predicateRuns,
    noiseRemoved: report.items.length - report.minimalCause.length,
    note: 'Synthetic workflow demonstration; not production evidence.',
  }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
