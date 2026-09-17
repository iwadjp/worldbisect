#!/usr/bin/env node
'use strict';
// Dependency-free, bounded snapshot delta debugging. No Git mutation commands.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawn, execFileSync} = require('node:child_process');
const WIN = process.platform === 'win32';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const MAX_FILES = 512, MAX_BYTES = 32 * 1024 * 1024;
const RESERVED = new Set(['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TMP','TEMP','TMPDIR']);
const key = p => WIN ? p.toLowerCase() : p;
function rel(p) {
  if (typeof p !== 'string') throw Error('Path must be a string');
  p = p.replace(/\\/g, '/');
  if (!p || p.startsWith('/') || p.split('/').some(s => !s || s==='.' || s==='..' || /[:\x00-\x1f]/.test(s) || s.toLowerCase()==='.git' || (WIN && /[. ]$|^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s)))) throw Error('Unsafe relative path');
  return p;
}
function readSafe(root, name) {
  name=rel(name); let current=root;
  if (fs.lstatSync(root).isSymbolicLink()) throw Error('Snapshot root cannot be a link');
  for (const part of name.split('/')) { current=path.join(current,part); if(fs.lstatSync(current).isSymbolicLink()) throw Error('Links/junctions are unsupported'); }
  const stat=fs.statSync(current);
  if(!stat.isFile() || stat.size > MAX_BYTES) throw Error('Unsupported file or size limit');
  return fs.readFileSync(current);
}
function envMap(input={}) {
  if (!input || Array.isArray(input) || typeof input !== 'object') throw Error('env must be an object');
  const result = Object.create(null);
  for(const [raw,v] of Object.entries(input)) {
    const k=WIN ? raw.toUpperCase() : raw;
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || RESERVED.has(k.toUpperCase()) || k.toUpperCase().startsWith('GIT_')) throw Error('Unsafe/reserved env key: '+k);
    if (v!==null && (typeof v!=='string' || v.includes('\0'))) throw Error('env values must be strings or null');
    if(Object.hasOwn(result,k) && result[k]!==v) throw Error('Conflicting env casing: '+k);
    result[k]=v;
  }
  return result;
}
// Cosmetic PATH changes compare equal on Windows; exact values are kept for execution.
function envComparable(k,v) {
  return WIN && k==='PATH' && v!==null && v!==undefined ? v.split(';').map(s=>s.replace(/\\/g,'/').replace(/\/$/,'').toLowerCase()).join(';') : v;
}
function git(repo,...args) { return execFileSync('git',['-C',repo,...args],{env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']}); }
function writeFile(root,name,bytes) { const dest=path.join(root,rel(name)); fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.writeFileSync(dest,bytes); }
function collectDirectory(root) {
  const result=[];
  function visit(folder,prefix='') {
    for(const e of fs.readdirSync(folder,{withFileTypes:true})) {
      const p=prefix+e.name; rel(p);
      if(e.isSymbolicLink()) throw Error('Links/junctions are unsupported');
      if(e.isDirectory()) visit(path.join(folder,e.name),p+'/');
      else if(e.isFile()) result.push(p); else throw Error('Special file unsupported');
      if(result.length>MAX_FILES) throw Error('File count limit');
    }
  }
  visit(root); return result.sort();
}
function capture({repo,out,env={},include=[],source=[]}) {
  repo=fs.realpathSync(repo); out=path.resolve(out);
  if(fs.existsSync(out)) throw Error('Snapshot output must not already exist');
  if(key(out)===key(repo) || key(out).startsWith(key(repo)+path.sep)) throw Error('Snapshot output must be outside input repo');
  const commit=git(repo,'rev-parse','HEAD').toString().trim();
  const tracked=git(repo,'ls-tree','-r','--name-only','-z',commit).toString().split('\0').filter(Boolean);
  const selected=source.length ? source.map(rel) : tracked;
  const trackedSet=new Set(tracked.map(key));
  if(selected.some(p=>!tracked.includes(p))) throw Error('source must name tracked files in HEAD exactly');
  if(selected.some(p=>p.split('/').includes('node_modules'))) throw Error('node_modules source excluded');
  const dirty=git(repo,'diff','--name-only','-z','HEAD','--',...selected).toString().split('\0').filter(Boolean);
  if(dirty.length) throw Error('Selected tracked source is dirty; prepare a clean source snapshot');
  const extras=new Set();
  for(const raw of include) {
    const p=rel(raw);
    if (p==='node_modules' || (p.startsWith('node_modules/') && p!=='node_modules/.cache' && !p.startsWith('node_modules/.cache/'))) throw Error('Only node_modules/.cache entries supported');
    if(!fs.existsSync(path.join(repo,p))) continue;
    if(fs.lstatSync(path.join(repo,p)).isSymbolicLink()) throw Error('Links/junctions unsupported');
    if(fs.statSync(path.join(repo,p)).isDirectory()) for(const sub of collectDirectory(path.join(repo,p))) extras.add(p+'/'+sub);
    else extras.add(p);
  }
  if([...extras].some(p=>trackedSet.has(key(p)))) throw Error('include must contain only Git-external files');
  if(selected.length+extras.size>MAX_FILES) throw Error('File count limit; use --source for a bounded source slice');
  const manifest={version:1,commit,sourceScope:source.length?'explicit tracked slice':'all tracked files',env:envMap(env),source:{},world:{}};
  const staged=[]; let bytes=0;
  for(const [kind,names] of [['source',selected],['world',[...extras]]]) for(const p of names) {
    const b=readSafe(repo,p); bytes+=b.length;
    if(bytes>MAX_BYTES) throw Error('Snapshot exceeds 32 MiB');
    manifest[kind][p]=sha(b); staged.push([kind+'/'+p,b]);
  }
  // Input reading and validation finish before creating the output.
  fs.mkdirSync(out,{recursive:true});
  for(const [p,b] of staged) writeFile(out,p,b);
  fs.writeFileSync(path.join(out,'world.json'),JSON.stringify(manifest,null,2));
  return {commit,sourceFiles:selected.length,worldFiles:extras.size,bytes};
}
function loadWorld(root) {
  root=fs.realpathSync(root);
  const m=JSON.parse(readSafe(root,'world.json').toString('utf8').replace(/^\uFEFF/,''));
  if(m.version!==1 || !/^[0-9a-f]{40,64}$/.test(m.commit)) throw Error('Invalid snapshot manifest');
  const result={root,commit:m.commit,env:envMap(m.env),source:new Map(),world:new Map()};
  let total=0,count=0;
  for(const kind of ['source','world']) {
    if(!m[kind] || Array.isArray(m[kind]) || typeof m[kind]!=='object') throw Error('Missing snapshot file map');
    const listed=Object.keys(m[kind]);
    const disk=fs.existsSync(path.join(root,kind))?collectDirectory(path.join(root,kind)):[];
    if(JSON.stringify([...listed].sort())!==JSON.stringify(disk)) throw Error('Unmanifested/missing snapshot files');
    for(const p of listed) {
      rel(p); const k=key(p); const b=readSafe(root,kind+'/'+p);
      if(sha(b)!==m[kind][p]) throw Error('Snapshot hash mismatch: '+p);
      if(result.source.has(k) || result.world.has(k)) throw Error('Case/source collision');
      if(++count>MAX_FILES || (total+=b.length)>MAX_BYTES) throw Error('Snapshot size limit');
      result[kind].set(k,{name:p,bytes:b,hash:sha(b)});
    }
  }
  if(!result.source.size) throw Error('At least one tracked source file is required');
  return result;
}
function diffWorlds(a,b) {
  if(a.commit!==b.commit || a.source.size!==b.source.size || [...a.source].some(([k,v])=>b.source.get(k)?.hash!==v.hash)) throw Error('Tracked source/commit mismatch');
  // Refuse file/directory topology conflicts that cannot be independent atomic entries.
  const paths=new Set([...a.source.keys(),...a.world.keys(),...b.world.keys()]);
  for(const p of paths) {const parts=p.split('/');while(parts.length>1){parts.pop();if(paths.has(parts.join('/')))throw Error('File/directory topology conflict unsupported');}}
  const items=[];
  for(const k of [...new Set([...Object.keys(a.env),...Object.keys(b.env)])].sort()) {
    if(envComparable(k,a.env[k]??null)!==envComparable(k,b.env[k]??null)) items.push({id:'ENV:'+k,kind:'env',key:k});
  }
  for(const k of [...new Set([...a.world.keys(),...b.world.keys()])].sort()) {
    if(a.world.get(k)?.hash!==b.world.get(k)?.hash) items.push({id:'FILE:'+(b.world.get(k)||a.world.get(k)).name,kind:'file',key:k,change:!a.world.has(k)?'add':!b.world.has(k)?'delete':'modify'});
  }
  return items;
}
function baseEnv() {
  const e=Object.create(null);
  for(const [k,v] of Object.entries(process.env)) if(['SYSTEMROOT','WINDIR','COMSPEC','PATH','PATHEXT','LANG','LC_ALL'].includes(k.toUpperCase())) e[WIN?k.toUpperCase():k]=v;
  return e;
}
async function execute(command,cwd,env,timeoutMs,failPattern,captureOutput=false) {
  const started=Date.now(); let stdout='',stderr='',over=false,timedOut=false;
  return new Promise(resolve=>{
    let done=false,timer,fallback,child;
    const finish=(code,signal,error)=>{
      if(done)return; done=true; clearTimeout(timer); clearTimeout(fallback);
      const match=stderr.match(failPattern)||stdout.match(failPattern);
      const classification=timedOut||over||error||signal?'INCONCLUSIVE':code===0?'PASS':code===1&&match?'FAIL':'INCONCLUSIVE';
      resolve({classification,signature:classification==='FAIL'?(match[1]||match[0]):null,exitCode:code,signal:signal||null,reason:timedOut?'timeout':over?'output-limit':error?'spawn-error':classification==='INCONCLUSIVE'?'unrecognized-exit-or-crash':null,elapsedMs:Date.now()-started,stdoutSha256:sha(stdout),stderrSha256:sha(stderr),...(captureOutput?{stdout,stderr}:{})});
    };
    const stop=()=>{
      if(child.pid) {
        if(WIN) { try {execFileSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true,timeout:5000});}catch{} }
        else {try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}
      }
      fallback=setTimeout(()=>finish(null,null,'termination-timeout'),1000);
    };
    try { child=spawn(command[0],command.slice(1),{cwd,env,shell:false,windowsHide:true,detached:!WIN,stdio:['ignore','pipe','pipe']}); }
    catch(e){finish(null,null,e);return;}
    child.stdout.on('data',b=>{stdout+=b.toString();if(stdout.length+stderr.length>1024*1024&&!over){over=true;stop();}});
    child.stderr.on('data',b=>{stderr+=b.toString();if(stdout.length+stderr.length>1024*1024&&!over){over=true;stop();}});
    child.on('error',e=>finish(null,null,e)); child.on('close',(c,s)=>finish(c,s));
    timer=setTimeout(()=>{timedOut=true;stop();},timeoutMs);
  });
}
// Check the launcher's effective environment in a child, before trusting a predicate.
// Only keys declared in either snapshot are contractual; unlisted OS additions are ambient.
async function verifyEnvironment(env,keys,cwd,timeoutMs) {
  const script="const c=require('node:crypto');const keys=JSON.parse(process.argv[1]);process.stdout.write(JSON.stringify(keys.map(k=>{const v=process.env[k];return {key:k,state:v===undefined?'ABSENT_EFFECTIVE':v===''?'EMPTY':'SET',hash:v===undefined?null:c.createHash('sha256').update(v).digest('hex')};})));";
  const probe=await execute([process.execPath,'-e',script,JSON.stringify(keys)],cwd,env,timeoutMs,/$^/,true);
  if(probe.classification!=='PASS')return {status:'INCONCLUSIVE',reason:'env-probe-failed',probeReason:probe.reason,exitCode:probe.exitCode};
  try {
    const observed=JSON.parse(probe.stdout);
    if(!Array.isArray(observed)||observed.length!==keys.length)throw Error('Invalid probe');
    const checks=keys.map((k,i)=>{
      const value=Object.hasOwn(env,k)?env[k]:undefined;
      const requested=value===undefined?'ABSENT_REQUESTED':value===''?'EMPTY':'SET';
      const effective=observed[i];
      if(effective.key!==k||!['ABSENT_EFFECTIVE','EMPTY','SET'].includes(effective.state))throw Error('Invalid probe');
      const matches=value===undefined?effective.state==='ABSENT_EFFECTIVE':effective.state===(value===''?'EMPTY':'SET')&&effective.hash===sha(value);
      return {key:k,requested,effective:effective.state,matches,...(!matches&&value===undefined?{detail:'REINJECTED_OR_UNREMOVABLE'}:{})};
    });
    return {status:checks.every(c=>c.matches)?'PASS':'INCONCLUSIVE',checks};
  } catch {return {status:'INCONCLUSIVE',reason:'env-probe-invalid-output'};}
}
function safeRemove(root,ownedParent) {
  const r=path.resolve(root),p=path.resolve(ownedParent);
  if(!key(r).startsWith(key(p)+path.sep) || path.dirname(r)!==p || !path.basename(r).startsWith('worldbisect-')) throw Error('Refusing unsafe temporary cleanup');
  fs.rmSync(r,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
class Oracle {
  constructor(a,b,items,options={}) {
    this.a=a;this.b=b;this.items=items;
    this.command=options.command;this.repeat=options.repeat??3;this.timeoutMs=options.timeoutMs??10000;
    this.maxRuns=options.maxRuns??500;this.pattern=new RegExp(options.failPattern??'^WORLDBISECT:FAIL:([^\\r\\n]+)$','m');
    if(!Array.isArray(this.command)||!this.command.length||!this.command.every(x=>typeof x==='string')) throw Error('command argv required');
    if(!Number.isInteger(this.repeat)||this.repeat<2||this.repeat>10||!Number.isInteger(this.timeoutMs)||this.timeoutMs<1||!Number.isInteger(this.maxRuns)||this.maxRuns<1) throw Error('Invalid repeat/timeout/budget');
    this.logs=[];this.experiments=[];this.cache=new Map();this.ambient=baseEnv();this.target=null;
  }
  async once(indices,reverse=false) {
    if(this.logs.length>=this.maxRuns) throw Error('Trial budget exhausted');
    const parent=fs.realpathSync(os.tmpdir());const temp=fs.mkdtempSync(path.join(parent,'worldbisect-'));
    const cwd=path.join(temp,'work'),home=path.join(temp,'home');fs.mkdirSync(cwd);fs.mkdirSync(home);
    const world=new Map(this.a.world),env={...this.ambient};
    for(const [k,v] of Object.entries(this.a.env)) { if(v===null) delete env[k];else env[k]=v; }
    const selected=reverse?[...indices].reverse():indices;
    for(const i of selected) {
      const d=this.items[i];
      if(d.kind==='env') {const v=this.b.env[d.key];if(v==null)delete env[d.key];else env[d.key]=v;}
      else if(this.b.world.has(d.key)) world.set(d.key,this.b.world.get(d.key));else world.delete(d.key);
    }
    for(const k of RESERVED) env[k]=home;
    let result,environmentCheck,predicateExecuted=false;
    try {
      // A Node startup can run trusted NODE_OPTIONS preloads. Keep their local
      // file/home effects separate from the predicate's fresh working copy.
      const probeCwd=path.join(temp,'env-probe'),probeHome=path.join(temp,'env-probe-home');
      fs.mkdirSync(probeCwd);fs.mkdirSync(probeHome);
      const probeEnv={...env};for(const k of RESERVED)probeEnv[k]=probeHome;
      environmentCheck=await verifyEnvironment(probeEnv,[...new Set([...Object.keys(this.a.env),...Object.keys(this.b.env)])].sort(),probeCwd,this.timeoutMs);
      if(environmentCheck.status!=='PASS') {
        result={classification:'INCONCLUSIVE',signature:null,reason:environmentCheck.reason||'requested-effective-env-mismatch'};
      } else {
        const material=[...this.a.source.values(),...world.values()];if(reverse)material.reverse();
        for(const f of material) writeFile(cwd,f.name,f.bytes);
        predicateExecuted=true;
        result=await execute(this.command,cwd,env,this.timeoutMs,this.pattern);
      }
    } catch(e) {result={classification:'INCONCLUSIVE',reason:'materialization-or-execution-error',error:e.message};}
    finally {safeRemove(temp,parent);}
    this.logs.push({run:this.logs.length+1,items:indices.map(i=>this.items[i].id),reverse,predicateExecuted,environmentCheck,...result});
    return result;
  }
  async test(indices,{fresh=false,reverse=false,label='search'}={}) {
    indices=[...indices].sort((a,b)=>a-b);const cacheKey=indices.join(',');
    if(!fresh&&this.cache.has(cacheKey))return this.cache.get(cacheKey);
    const runs=[];for(let r=0;r<this.repeat;r++) runs.push(await this.once(indices,reverse));
    const stable=runs.every(r=>r.classification===runs[0].classification && r.signature===runs[0].signature);
    let classification=stable?runs[0].classification:'INCONCLUSIVE';
    if(classification==='FAIL'&&this.target!==null&&runs[0].signature!==this.target)classification='INCONCLUSIVE';
    this.experiments.push({label,items:indices.map(i=>this.items[i].id),classification,runNumbers:this.logs.slice(-this.repeat).map(r=>r.run)});
    if(classification==='INCONCLUSIVE') throw Error('Unstable, unresolved, or different failure: '+label);
    this.cache.set(cacheKey,classification);return classification;
  }
}
async function ddmin(all,test) {
  let current=[...all],n=2;
  while(current.length>=2) {
    const parts=[];for(let i=0;i<n;i++)parts.push(current.slice(Math.floor(i*current.length/n),Math.floor((i+1)*current.length/n)));
    let next=null;
    for(const part of parts) if(await test(part)==='FAIL'){next=part;break;}
    if(next===null) for(const part of parts) {const set=new Set(part),rest=current.filter(x=>!set.has(x));if(await test(rest)==='FAIL'){next=rest;break;}}
    if(next!==null){current=next;n=Math.max(2,n-1);}else if(n===current.length)break;else n=Math.min(current.length,n*2);
  }
  return current;
}
async function minimize(a,b,options) {
  const started=Date.now(),items=diffWorlds(a,b),oracle=new Oracle(a,b,items,options),all=items.map((_,i)=>i);
  const report={status:'INCONCLUSIVE',sourceCommit:a.commit,items:items.map(({id,kind,change})=>({id,kind,change})),minimalCause:null,minimality:'not established',repeat:oracle.repeat};
  try {
    if(await oracle.test([],{label:'baseline A'})!=='PASS')throw Error('A must PASS');
    if(await oracle.test(all,{label:'baseline B'})!=='FAIL')throw Error('B must FAIL');
    oracle.target=oracle.logs.at(-1).signature;
    const found=await ddmin(all,s=>oracle.test(s));
    if(await oracle.test(found,{fresh:true,label:'confirm minimum'})!=='FAIL')throw Error('Minimum failed replay');
    if(await oracle.test(found,{fresh:true,reverse:true,label:'reverse materialization'})!=='FAIL')throw Error('Order-dependent reproduction');
    for(const i of found) if(await oracle.test(found.filter(x=>x!==i),{fresh:true,label:'fresh one-item removal'})!=='PASS')throw Error('Minimality changed during confirmation');
    if(await oracle.test([],{fresh:true,label:'final A'})!=='PASS'||await oracle.test(all,{fresh:true,label:'final B'})!=='FAIL')throw Error('Baseline drift');
    const remainder=all.filter(i=>!found.includes(i));
    const residual=await oracle.test(remainder,{fresh:true,label:'residual differences'});
    Object.assign(report,{status:'PASS',minimalCause:found.map(i=>items[i].id),minimality:'observed 1-minimal, not global cardinality minimum or unique cause',failureSignature:oracle.target,residualReproduces:residual==='FAIL'});
  } catch(e) {report.reason=e.message;}
  Object.assign(report,{predicateRuns:oracle.logs.filter(r=>r.predicateExecuted).length,environmentProbeRuns:oracle.logs.filter(r=>r.environmentCheck).length,trialRuns:oracle.logs.length,experiments:oracle.experiments,executions:oracle.logs,elapsedMs:Date.now()-started});
  return report;
}
function parse(argv) {
  const opts={include:[],source:[]};let command=[];
  for(let i=0;i<argv.length;i++) {
    if(argv[i]==='--'){command=argv.slice(i+1);break;}
    if(!argv[i].startsWith('--')||i+1===argv.length)throw Error('Expected --option value');
    const k=argv[i].slice(2),v=argv[++i];
    if(['include','source'].includes(k))opts[k].push(v);else opts[k]=v;
  }
  return {opts,command};
}
async function main() {
  const [mode,...argv]=process.argv.slice(2);
  if(!mode||mode==='--help') {console.log('snapshot --repo PATH --out NEW_PATH [--env env.json] [--include PATH] [--source TRACKED_FILE]\nrun --a SNAPSHOT --b SNAPSHOT --out NEW_REPORT.json [--repeat 3] [--timeout-ms 10000] [--fail-pattern REGEX] -- executable args...');return;}
  const {opts:o,command}=parse(argv);
  if(mode==='snapshot') {
    console.log(JSON.stringify(capture({...o,env:o.env?JSON.parse(fs.readFileSync(o.env,'utf8').replace(/^\uFEFF/,'')):{}}),null,2));return;
  }
  if(mode!=='run'||!o.a||!o.b||!o.out)throw Error('run requires --a --b --out');
  const out=path.resolve(o.out),a=loadWorld(o.a),b=loadWorld(o.b);
  if([a.root,b.root].some(r=>key(out)===key(r)||key(out).startsWith(key(r)+path.sep))) throw Error('Report must be outside inputs');
  if(fs.existsSync(out))throw Error('Report already exists');
  const report=await minimize(a,b,{command,repeat:o.repeat===undefined?3:Number(o.repeat),timeoutMs:o['timeout-ms']===undefined?10000:Number(o['timeout-ms']),maxRuns:o['max-runs']===undefined?500:Number(o['max-runs']),failPattern:o['fail-pattern']});
  fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({status:report.status,minimalCause:report.minimalCause,predicateRuns:report.predicateRuns,reason:report.reason},null,2));process.exitCode=report.status==='PASS'?0:2;
}
if(require.main===module)main().catch(e=>{console.error('INCONCLUSIVE: '+e.message);process.exitCode=2;});
module.exports={capture,loadWorld,diffWorlds,minimize,Oracle,ddmin,envMap,envComparable,rel,sha};
