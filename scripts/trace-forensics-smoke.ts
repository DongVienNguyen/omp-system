import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/state';
import {digest} from '../src/contracts';
import {sealEvidence} from '../src/evidence';
import {root,profileRoot,protectedHashes,childEnvironment} from './dev-preflight';
import {admitResources} from '../src/resource-admission';
const node=process.argv[2];if(!node)throw Error('Explicit Node executable required for inspector capture');
const admission=await admitResources(root,true);let store:Store|undefined;
try{
const id='trace-'+randomUUID(),project=join(root,'.lab','workspaces',id),before=protectedHashes();mkdirSync(project,{recursive:true});
const capture=`const inspector=require('node:inspector'),fs=require('node:fs'),v8=require('node:v8');const s=new inspector.Session();s.connect();const post=(method,params={})=>new Promise((resolve,reject)=>s.post(method,params,(error,result)=>error?reject(error):resolve(result)));function measuredWork(){let value=0;for(let i=0;i<8000000;i++)value+=Math.sqrt(i);return value;} (async()=>{await post('Profiler.enable');await post('Profiler.start');global.result=measuredWork();const {profile}=await post('Profiler.stop');fs.writeFileSync('actual.cpuprofile',JSON.stringify(profile));global.retained=Array.from({length:200},(_,i)=>({traceObject:i,data:'retained-'+i}));v8.writeHeapSnapshot('actual.heapsnapshot');s.disconnect();console.log(JSON.stringify({result:global.result,retained:global.retained.length}));})().catch(e=>{console.error(e);process.exitCode=1});`;
writeFileSync(join(project,'capture.cjs'),capture);
const captured=spawnSync(node,['capture.cjs'],{cwd:project,encoding:'utf8',timeout:30000});assert.equal(captured.status,0,captured.stderr);
const agent=join(profileRoot('omp-system-dev'),'agent');store=new Store(join(agent,'omp-system',digest(project)));const proofs:unknown[]=[];
 for(const [index,path]of ['actual.cpuprofile','actual.heapsnapshot'].entries()){
  const spec={action:'trace',id:id+'-'+index,project,paths:[path],before:path,deadline:Date.now()+60000},authority={id:randomUUID(),action:'catalog-operator',project,specDigest:digest(spec),expires:spec.deadline},file=join(project,'request-'+index+'.json');writeFileSync(file,JSON.stringify(spec));sealEvidence(store,'authority',authority.id,authority);
  const original=digest(readFileSync(join(project,path)).toString('base64'));
  const env:NodeJS.ProcessEnv={...childEnvironment('omp-system-dev'),BUN_BE_BUN:'1'};delete env.OMP_SYSTEM_API_KEY;
  const child=spawnSync(process.execPath,[join(root,'src','catalog-operator-cli.ts'),file,authority.id,project],{cwd:project,env,encoding:'utf8',timeout:65000,maxBuffer:4*1024**2});assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);assert.equal(result.reexecuted,false);assert.equal(result.assessment,'HYPOTHESIS');assert.equal(digest(readFileSync(join(project,path)).toString('base64')),original);if(index===0){assert.equal(result.before.format,'cpuprofile');assert(result.before.hot.some((f:any)=>f.name==='measuredWork'&&f.url.endsWith('capture.cjs')))}else{assert.equal(result.before.format,'heapsnapshot');assert(result.before.nodeCount>200);assert(result.before.retainerChain.length>0)}
  proofs.push(result);
 }
 writeFileSync(join(project,'live.cjs'),'global.calls=0;global.work=function work(){global.calls++;let n=0;for(let i=0;i<500000;i++)n+=Math.sqrt(i);global.value=n;return n};setInterval(global.work,5);');
 const live=spawn(node,['--no-opt','--inspect=127.0.0.1:0','live.cjs'],{cwd:project,stdio:['ignore','ignore','pipe']});
 try{
  const endpoint=await new Promise<string>((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Inspector startup timeout')),10000);live.stderr.on('data',b=>{text+=b;const match=text.match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/);if(match){clearTimeout(timer);resolve(match[0])}});live.once('error',reject)});
  const spec={action:'runtime-forensics',id:id+'-live',project,endpoint,expectedPid:live.pid,output:'live.cpuprofile',sampleMs:100,instrumentation:{expression:'(()=>{for(let i=0;i<20;i++)global.work();return {observed:global.calls>0}})()',expected:{observed:true}},deadline:Date.now()+20000},authority={id:randomUUID(),action:'catalog-operator',project,specDigest:digest(spec),expires:spec.deadline},file=join(project,'live-request.json');writeFileSync(file,JSON.stringify(spec));sealEvidence(store,'authority',authority.id,authority);
  const env:NodeJS.ProcessEnv={...childEnvironment('omp-system-dev'),BUN_BE_BUN:'1'};delete env.OMP_SYSTEM_API_KEY;
  const child=spawnSync(process.execPath,[join(root,'src','catalog-operator-cli.ts'),file,authority.id,project],{cwd:project,env,encoding:'utf8',timeout:25000,maxBuffer:4*1024**2});assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);assert.deepEqual(result.instrumentation.observed,{observed:true});assert(result.probe.before.hot.some((f:any)=>f.url.endsWith('live.cjs')&&f.line>0));proofs.push(result);
 }finally{live.kill();await new Promise<void>(resolve=>{if(live.exitCode!==null||live.signalCode!==null)resolve();else live.once('exit',()=>resolve())})}
 assert.deepEqual(protectedHashes(),before);const evidence={passed:true,project,actualCapture:JSON.parse(captured.stdout),proofs,protectedConfigUnchanged:true,inference:false};writeFileSync(join(project,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({passed:true,project,formats:proofs.map((p:any)=>p.before?.format??p.signal),protectedConfigUnchanged:true,inference:false}));
}finally{store?.close();admission.release()}
