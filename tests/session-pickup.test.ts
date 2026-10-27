import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {SessionManager} from '@oh-my-pi/pi-coding-agent';
import {Store} from '../src/state';
import {runSessionPickup} from '../src/session-pickup';
import {createHash} from 'node:crypto';
const dir=mkdtempSync(join(tmpdir(),'pickup-check-')),project=join(dir,'project'),other=join(dir,'other'),sessions=join(dir,'sessions');mkdirSync(project);mkdirSync(other);
const paths=await import(import.meta.resolve('@oh-my-pi/pi-coding-agent/session/session-paths'));const bucket=paths.sessionDirForCwd(project,sessions);mkdirSync(bucket,{recursive:true});
const manager=SessionManager.create(project,bucket);await manager.appendMessage({role:'user',content:'Fix bounded sum; preserve pin',timestamp:Date.now()});await manager.appendMessage({role:'assistant',content:[{type:'text',text:'Stopped after actual repro; pin stays unchanged.'}],api:'openai-completions',provider:'9router',model:'code-sol',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});
const file=manager.getSessionFile()!;await manager.flush();const original=readFileSync(file),store=new Store(join(dir,'state'));writeFileSync(join(project,'app.txt'),'inherited');const expected=createHash('sha256').update('inherited').digest('hex');
const spec={action:'session-history',id:'pickup',project,mode:'read',session:basename(file),all:false,offset:0,limit:20,artifacts:[{path:'app.txt',sha256:expected}],deadline:Date.now()+15000};
try{
 const listed=await runSessionPickup({...spec,mode:'list',session:undefined},store,project,sessions);assert('sessions'in listed&&listed.sessions.some(s=>s.id===manager.getSessionId()));
 const result=await runSessionPickup(spec,store,project,sessions);assert('text'in result&&result.text.includes('Stopped after actual repro'));assert('inheritedArtifactsValid'in result&&result.inheritedArtifactsValid);assert.equal(result.reexecuted,false);assert(readFileSync(file).equals(original));
 writeFileSync(join(project,'app.txt'),'changed');const changed=await runSessionPickup({...spec,id:'changed'},store,project,sessions);assert('route'in changed&&changed.route==='reconcile-artifacts');
 const foreign=join(bucket,'foreign.jsonl');writeFileSync(foreign,original.toString().replaceAll(project.replaceAll('\\','\\\\'),other.replaceAll('\\','\\\\')));await assert.rejects(runSessionPickup({...spec,id:'foreign',session:'foreign.jsonl'},store,project,sessions),/another workspace/);
 const old=join(bucket,'old.jsonl'),oldTime=new Date(Date.now()-10*86400000);writeFileSync(old,original);utimesSync(old,oldTime,oldTime);const windowed=await runSessionPickup({...spec,mode:'list',session:undefined},store,project,sessions);assert('sessions'in windowed&&!windowed.sessions.some(s=>s.file==='old.jsonl'));await assert.rejects(runSessionPickup({...spec,session:'old.jsonl'},store,project,sessions),/older/);const archived=await runSessionPickup({...spec,all:true,session:'old.jsonl'},store,project,sessions);assert('text'in archived&&archived.text.includes('Stopped after actual repro'));
 writeFileSync(join(project,'large.bin'),Buffer.alloc(16*1024**2+1));await assert.rejects(runSessionPickup({...spec,artifacts:[{path:'large.bin',sha256:'0'.repeat(64)}]},store,project,sessions),/16 MiB/);
 console.log('session-pickup: native session list/read, same-workspace custody, inherited artifact mismatch and no source replay PASS');
}finally{store.close();rmSync(dir,{recursive:true,force:true})}
