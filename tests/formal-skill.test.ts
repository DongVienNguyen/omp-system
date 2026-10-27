import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/state';
import {executeCheck} from '../src/checks';
import {spawnSync} from 'node:child_process';
import {snapshot} from '../src/workspaces';
import {executeFormalSkill} from '../src/formal-skill';
import type {MethodHost} from '../src/pstack';
import {proveFormalSkill,readFormalSkill,type FormalSkillOperation} from '../src/formal-skill';
import {parseLocalCatalog} from '../src/catalog-local';
const project=mkdtempSync(join(tmpdir(),'formal-skill-')),directory='.agents/skills/verify-send',operation:FormalSkillOperation={kind:'create-formal-verification-skill',directory,coverage:['source.cjs'],commandId:'bounded-source',failureSignal:'SendBound',verifierPaths:['check.cjs']};
const store=new Store(join(project,'state')),source='exports.maySend = sent => sent < 2;\n';
try{
 const workflow={id:'formal-scope',kind:'catalog',project,trustedCode:true,task:'Verify bounded source',paths:['src','.agents/skills','check.cjs'],write_scope:['.agents/skills'],checks:[{id:'bounded-source',executable:process.execPath,args:['check.cjs'],timeoutMs:10000,runner:'command',proof:{kind:'exit-code',reason:'Bounded source checker'},input_scope:['check.cjs']}],workflow:{name:operation.kind,sha256:'a'.repeat(64)},rubric:['Coverage','Falsification','Sync'],budget:{maxCalls:3,deadline:Date.now()+60000,max_output_tokens:16384,max_input_bytes:1048576,max_output_bytes:262144}};
 for(const alias of ['src/./product.cjs','SRC/product.cjs']){if(alias.startsWith('SRC')&&process.platform!=='win32')continue;assert.throws(()=>parseLocalCatalog({workflow:{...workflow,paths:[...workflow.paths,'SRC'],write_scope:['.agents/skills',alias]},operation:{...operation,coverage:['src/product.cjs']}}),/Canonical|read-only/);}
 assert.throws(()=>parseLocalCatalog({workflow:{...workflow,paths:['src','scratch','check.cjs'],write_scope:['scratch']},operation:{...operation,directory:'scratch/verify-send',coverage:['src/product.cjs']}}),/native project/);
 mkdirSync(join(project,directory),{recursive:true});writeFileSync(join(project,'source.cjs'),source);
 writeFileSync(join(project,'check.cjs'),"const {maySend}=require('./source.cjs');for(let sent=0;sent<=3;sent++){if(maySend(sent)!==(sent<2)){console.log(JSON.stringify({outcome:'violated',property:'SendBound',counterexample:['sent='+sent,'maySend returned '+maySend(sent)]}));process.exit(1)}}console.log('SendBound: all four states checked');\n");
 writeFileSync(join(project,directory,'SKILL.md'),'---\nname: verify-send\ndescription: Check send bound after changes to maySend.\nsync_commit: '+'a'.repeat(40)+'\n---\nRun check.cjs; covers sent 0 through 3 only.\n');
 const manifest={syncCommit:'a'.repeat(40),property:'No send at or above two',harm:'Extra sends exceed admitted limit',bounds:'sent integers 0 through 3',assumptions:['Single synchronous maySend call'],coverage:[{path:'source.cjs',symbol:'maySend',line:1}],commandId:'bounded-source',mutation:{path:'source.cjs',before:'sent < 2',after:'sent <= 2'}};
 writeFileSync(join(project,directory,'verification.json'),JSON.stringify(manifest));
 const check=()=>executeCheck(store,{id:'bounded-source',executable:process.execPath,args:['check.cjs'],cwd:project,timeoutMs:10000,runner:'command',proof:{kind:'exit-code',reason:'Enumerate four source states and reject excess send'}},{candidate:'scratch',policy:'frozen',plan:'bounded-source'},{trustedCode:true,root:project}).then(row=>[row]);
 const result=await proveFormalSkill(project,operation,check);
 assert.equal(result.verified,true,JSON.stringify(result));assert.match(result.challenges[0]!.observation,/"property":"SendBound"/);assert.equal(readFileSync(join(project,'source.cjs'),'utf8'),source);
 await assert.rejects(proveFormalSkill(project,operation,async()=>{if(readFileSync(join(project,'source.cjs'),'utf8')!==source)throw Error('Interrupted check');return check()}),/Interrupted check/);
 assert.equal(readFileSync(join(project,'source.cjs'),'utf8'),source);
 writeFileSync(join(project,directory,'verification.json'),JSON.stringify({...manifest,mutation:{...manifest.mutation,after:'sent < ('}}));
 assert.equal((await proveFormalSkill(project,operation,check)).verified,false);assert.equal(readFileSync(join(project,'source.cjs'),'utf8'),source);
 writeFileSync(join(project,directory,'verification.json'),JSON.stringify(manifest));
 assert.equal((await proveFormalSkill(project,{...operation,failureSignal:'OtherProperty'},check)).verified,false);
 writeFileSync(join(project,directory,'verification.json'),JSON.stringify({...manifest,mutation:{...manifest.mutation,before:'missing'}}));
 assert.throws(()=>readFormalSkill(project,operation),/exactly once/);
 const git=(args:string[])=>{const r=spawnSync('git',args,{cwd:project,encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'}});assert.equal(r.status,0,r.stderr);return r.stdout.trim()};
 writeFileSync(join(project,directory,'verification.json'),JSON.stringify(manifest));git(['init','-b','main']);git(['add','source.cjs','check.cjs',directory]);git(['-c','user.name=Local Verification','-c','user.email=local@invalid','commit','-m','test: source baseline']);const baselineCommit=git(['rev-parse','HEAD']);
 git(['checkout','-b','side']);writeFileSync(join(project,'side.txt'),'Independent side change\n');git(['add','side.txt']);git(['-c','user.name=Local Verification','-c','user.email=local@invalid','commit','-m','test: side branch']);git(['checkout','main']);
 writeFileSync(join(project,'main.txt'),'Independent main change\n');git(['add','main.txt']);git(['-c','user.name=Local Verification','-c','user.email=local@invalid','commit','-m','test: main branch']);git(['-c','user.name=Local Verification','-c','user.email=local@invalid','merge','--no-ff','--no-commit','side']);
 writeFileSync(join(project,'source.cjs'),source.replace('sent < 2','sent <= 2'));git(['add','source.cjs']);git(['-c','user.name=Local Verification','-c','user.email=local@invalid','commit','-m','test: merge introduces excess-send regression']);const bugCommit=git(['rev-parse','HEAD']);
 const oldManifest=JSON.stringify({...manifest,syncCommit:baselineCommit}),oldSkill=readFileSync(join(project,directory,'SKILL.md'),'utf8').replace('a'.repeat(40),baselineCommit);writeFileSync(join(project,directory,'verification.json'),oldManifest);writeFileSync(join(project,directory,'SKILL.md'),oldSkill);
 const base=snapshot(store,project,['source.cjs','check.cjs',directory]),maintenance={...operation,kind:'maintain-formal-verification-skill' as const};let blocking=true,breakRestore=false,postAuthorChecks=0;
 const host:MethodHost={workspace:async()=>project,verify:async()=>({passed:false,evidence:[]}),run:async(role)=>{
  if(role==='formal-author'){writeFileSync(join(project,directory,'SKILL.md'),oldSkill.replace(baselineCommit,bugCommit));writeFileSync(join(project,directory,'verification.json'),JSON.stringify({...manifest,syncCommit:bugCommit}));if(breakRestore){rmSync(join(project,directory,'verification.json'));mkdirSync(join(project,directory,'verification.json'));}return {id:role,role,body:JSON.stringify({outcome:breakRestore?'blocked':'bug',reason:'Real source permits third send',introducingCommit:bugCommit}),evidence:[],actualReads:['source.cjs']};}
  return {id:role,role,body:JSON.stringify({classification:'bug',introducingCommit:bugCommit,reason:'sent=2 incorrectly admits another send',findings:blocking?[{blocking:true,resolved:false,evidence:'Counterexample interpretation disputed'}]:[]}),evidence:[],actualReads:['source.cjs','check.cjs',directory+'/SKILL.md',directory+'/verification.json']};
 }};
 const context={workspace:project,base,project,host,check:async()=>{postAuthorChecks++;return check()},validate:async()=>true,task:'Maintain send bound',deadline:Date.now()+120000};
 await assert.rejects(executeFormalSkill(maintenance,context),/Unresolved blocking/);assert.equal(postAuthorChecks,2);assert.equal(readFileSync(join(project,directory,'SKILL.md'),'utf8'),oldSkill);assert.equal(readFileSync(join(project,directory,'verification.json'),'utf8'),oldManifest);
 blocking=false;const bug=await executeFormalSkill(maintenance,context);assert.equal(bug.outcome,'bug');assert.equal(bug.verified,false);assert.equal(readFileSync(join(project,directory,'SKILL.md'),'utf8'),oldSkill);
 git(['mv','source.cjs','renamed.cjs']);writeFileSync(join(project,'check.cjs'),readFileSync(join(project,'check.cjs'),'utf8').replace('./source.cjs','./renamed.cjs'));git(['add','check.cjs']);git(['-c','user.name=Local Verification','-c','user.email=local@invalid','commit','-m','test: rename covered source']);
 const renamedOperation={...maintenance,coverage:['renamed.cjs']},renamedBase=snapshot(store,project,['renamed.cjs','check.cjs',directory]);
 const renamedHost:MethodHost={...host,run:async(role,mission,inputs,options)=>{const result=await host.run(role,mission,inputs,options);return {...result,actualReads:result.actualReads?.map(p=>p==='source.cjs'?'renamed.cjs':p)}}};
 const renamedBug=await executeFormalSkill(renamedOperation,{...context,base:renamedBase,host:renamedHost});assert.equal(renamedBug.outcome,'bug');assert('introducingCommit'in renamedBug);assert.equal(renamedBug.introducingCommit,bugCommit);
 git(['mv','renamed.cjs','source.cjs']);writeFileSync(join(project,'check.cjs'),readFileSync(join(project,'check.cjs'),'utf8').replace('./renamed.cjs','./source.cjs'));
 writeFileSync(join(project,directory,'verification.json'),JSON.stringify({...manifest,syncCommit:bugCommit}));await assert.rejects(executeFormalSkill(maintenance,context),/Prior skill and manifest/);writeFileSync(join(project,directory,'verification.json'),oldManifest);
 breakRestore=true;await assert.rejects(executeFormalSkill(maintenance,context),/sync restoration incomplete/);assert.equal(readFileSync(join(project,directory,'SKILL.md'),'utf8'),oldSkill);rmSync(join(project,directory,'verification.json'),{recursive:true});writeFileSync(join(project,directory,'verification.json'),oldManifest);
 console.log('formal-skill: bounded real-source break detected, restored after success and interruption; stale mutation denied');
}finally{store.close();rmSync(project,{recursive:true,force:true})}
