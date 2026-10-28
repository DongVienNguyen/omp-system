import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/state';
import {runRuntimeForensics,validateRuntimeForensics} from '../src/runtime-forensics';
const node=import.meta.main&&process.argv[2]?process.argv[2]:'node';
const project=mkdtempSync(join(tmpdir(),'live-forensic-')),store=new Store(join(project,'state'));
writeFileSync(join(project,'app.cjs'),'global.calls=0;global.enabled=true;global.pulse=function pulse(){global.calls++;if(global.enabled){let n=0;for(let i=0;i<500000;i++)n+=Math.sqrt(i);global.value=n}};setInterval(global.pulse,5);');
const child=spawn(node,['--no-opt','--inspect=127.0.0.1:0','app.cjs'],{cwd:project,stdio:['ignore','ignore','pipe']});
try{
 const endpoint=await new Promise<string>((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Inspector startup timeout')),10000);child.stderr.on('data',b=>{text+=b;const match=text.match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/);if(match){clearTimeout(timer);resolve(match[0])}});child.once('error',reject)});
 const spec={action:'runtime-forensics',id:'live',project,endpoint,expectedPid:child.pid!,output:'live.cpuprofile',sampleMs:300,instrumentation:{expression:'(()=>{for(let i=0;i<20;i++)pulse();global.enabled=false;return {enabled:global.enabled,observed:global.calls>0}})()',expected:{enabled:false,observed:true}},deadline:Date.now()+15000};
 for(const endpoint of ['ws://example.com:9229/id','ws://127.0.0.1:9229/'])assert.throws(()=>validateRuntimeForensics({...spec,endpoint},project),/loopback/);
 await assert.rejects(runRuntimeForensics({...spec,id:'wrong',expectedPid:child.pid!+1,output:'wrong.cpuprofile'},store,project),/PID mismatch/);assert.equal(existsSync(join(project,'wrong.cpuprofile')),false);
 assert.equal(store.get<{state:string}>('catalog-operator','wrong')!.state,'FAILED');await assert.rejects(runRuntimeForensics({...spec,id:'wrong',output:'wrong-again.cpuprofile'},store,project),/already exists/);
 const result=await runRuntimeForensics(spec,store,project);assert.deepEqual(result.instrumentation.observed,{enabled:false,observed:true});assert.equal(result.analysis.before.format,'cpuprofile');assert.equal(result.confirmedCause,false);assert.equal(existsSync(join(project,'live.cpuprofile')),true);
 await assert.rejects(runRuntimeForensics({...spec,id:'mismatch',output:'mismatch.cpuprofile',instrumentation:{expression:'1',expected:2}},store,project),/differs/);assert.equal(store.get<{state:string}>('catalog-operator','mismatch')!.state,'FAILED');await assert.rejects(runRuntimeForensics({...spec,id:'mismatch',output:'other.cpuprofile'},store,project),/already exists/);
 await assert.rejects(runRuntimeForensics({...spec,id:'deadline',output:'deadline.cpuprofile',sampleMs:10,deadline:Date.now()+500,instrumentation:{expression:'new Promise(resolve=>setTimeout(()=>resolve(1),2000))',expected:1}},store,project),/deadline|cleanup/);assert.equal(store.get<{state:string}>('catalog-operator','deadline')!.state,'FAILED');
 const follow=await runRuntimeForensics({...spec,id:'after-deadline',output:'after-deadline.cpuprofile',deadline:Date.now()+10000,instrumentation:{expression:'(()=>{global.enabled=true;for(let i=0;i<20;i++)global.pulse();global.enabled=false;return 1})()',expected:1}},store,project);assert.equal(follow.instrumentation.matched,true);
 console.log(JSON.stringify({passed:true,signal:result.signal,mechanism:result.mechanism,actualPid:child.pid,source:result.probe.before.hot.find(f=>f.name==='pulse')??null}));
}finally{child.kill();await new Promise<void>(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',()=>resolve())});store.close();rmSync(project,{recursive:true,force:true})}
