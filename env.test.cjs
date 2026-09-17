'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const wb=require('./worldbisect.cjs');
const K='WORLDBISECT_FIXTURE_VAR';
function world(env) {
  const bytes=Buffer.from('fixture source\n');
  return {commit:'a'.repeat(40),env:wb.envMap(env),source:new Map([['fixture.txt',{name:'fixture.txt',bytes,hash:wb.sha(bytes)}]]),world:new Map()};
}
async function run(a,b,condition) {
  return wb.minimize(world(a),world(b),{repeat:2,command:[process.execPath,'-e',`if(${condition}){console.error('WORLDBISECT:FAIL:env-fixture');process.exitCode=1;}`]});
}
function found(r,key) {
  assert.equal(r.status,'PASS',r.reason);assert.deepEqual(r.minimalCause,['ENV:'+key]);
  assert.equal(r.residualReproduces,false);assert.equal(r.environmentProbeRuns,r.predicateRuns);
  assert.ok(r.executions.every(x=>x.environmentCheck.status==='PASS'));
}
test('custom SET -> ABSENT, with fresh minimality confirmation',async()=>{
  const r=await run({[K]:'set'},{[K]:null},`!Object.hasOwn(process.env,'${K}')`);found(r,K);
  assert.ok(r.executions.some(x=>x.environmentCheck.checks.some(c=>c.requested==='ABSENT_REQUESTED'&&c.effective==='ABSENT_EFFECTIVE')));
});
test('custom omitted -> EMPTY preserves empty instead of absence',async()=>{
  const r=await run({},{[K]:''},`Object.hasOwn(process.env,'${K}')&&process.env.${K}===''`);found(r,K);
});
test('custom SET value difference still minimizes',async()=>{
  found(await run({[K]:'good'},{[K]:'bad'},`process.env.${K}==='bad'`),K);
});
test('USERNAME SET difference still minimizes',async()=>{
  found(await run({USERNAME:'something'},{USERNAME:'WINDOWS_ACCOUNT_FIXTURE'},"process.env.USERNAME==='WINDOWS_ACCOUNT_FIXTURE'"),'USERNAME');
});
for(const omission of ['null','omitted'])test('USERNAME '+omission+' cannot become a false deletion cause',async()=>{
  const a={USERNAME:'WORLD_A_FIXTURE'},b=omission==='null'?{USERNAME:null}:{};
  const r=await run(a,b,"process.env.USERNAME!=='WORLD_A_FIXTURE'");
  if(process.platform==='win32'&&Object.hasOwn(process.env,'USERNAME')) {
    assert.equal(r.status,'INCONCLUSIVE');assert.equal(r.minimalCause,null);
    assert.equal(r.predicateRuns,2); // A ran, B was rejected before its predicate.
    const blocked=r.executions.filter(x=>!x.predicateExecuted);
    assert.equal(blocked.length,2);assert.ok(blocked.every(x=>x.reason==='requested-effective-env-mismatch'));
    assert.ok(blocked.every(x=>x.environmentCheck.checks.some(c=>c.key==='USERNAME'&&!c.matches&&c.requested==='ABSENT_REQUESTED')));
  } else found(r,'USERNAME');
});
test('unchanged explicit null is checked even without an env atom',async()=>{
  const a=world({USERNAME:null}),oracle=new wb.Oracle(a,a,[],{command:[process.execPath,'-e','process.exit(0)'],repeat:2});
  const r=await oracle.once([]);
  if(process.platform==='win32'&&Object.hasOwn(process.env,'USERNAME')) {
    assert.equal(r.classification,'INCONCLUSIVE');assert.equal(oracle.logs[0].predicateExecuted,false);
  } else assert.equal(r.classification,'PASS');
});
test('USERNAME EMPTY remains a supported distinct state',async()=>{
  found(await run({USERNAME:'something'},{USERNAME:''},"Object.hasOwn(process.env,'USERNAME')&&process.env.USERNAME===''") ,'USERNAME');
});
test('probe startup failure is inconclusive, never a cause',async()=>{
  const r=await run({NODE_OPTIONS:'--worldbisect-invalid-option'},{NODE_OPTIONS:'--worldbisect-invalid-option',[K]:'bad'},'true');
  assert.equal(r.status,'INCONCLUSIVE');assert.equal(r.minimalCause,null);assert.equal(r.predicateRuns,0);
  assert.ok(r.executions.every(x=>x.reason==='env-probe-failed'));
});
test('owned HOME/TEMP remain reserved from user env maps',()=>{
  for(const k of ['USERPROFILE','TEMP','TMP'])assert.throws(()=>wb.envMap({[k]:null}),/reserved/);
});
