import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,cpSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {root,profileRoot,protectedHashes} from './dev-preflight';
import {admitResources} from '../src/resource-admission';
import {openProvider} from '../src/provider';
import {Store} from '../src/state';
import {snapshot} from '../src/workspaces';
import {workflowCatalog} from '../src/catalog';
import {parseLocalCatalog,runLocalCatalog,localAuthoritySpec} from '../src/catalog-local';
import {authorizeExecution} from '../src/authority';
const admission=await admitResources(root,true),id='formal-skill-'+randomUUID(),work=join(root,'.lab','workspaces',id),project=join(work,'source'),directory='.agents/skills/verify-send';mkdirSync(project,{recursive:true});
const store=new Store(join(root,'.lab','state',id)),provider=await openProvider(join(profileRoot('omp-system-dev'),'agent')),before=protectedHashes(),deadline=Date.now()+480000;
const git=(args:string[])=>{const r=spawnSync('git',['-c','user.name=Local Verification','-c','user.email=local@invalid',...args],{cwd:project,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'},encoding:'utf8',timeout:10000});if(r.status!==0)throw Error('Owned formal Git fixture failed');return r.stdout.trim()};
try{
 writeFileSync(join(project,'source.cjs'),'exports.maySend = sent => sent < 2;\n');
 writeFileSync(join(project,'check.cjs'),"const {maySend}=require('./source.cjs');for(let sent=0;sent<=3;sent++){if(sent>=2&&maySend(sent)!==false){console.log(JSON.stringify({outcome:'violated',property:'SendBound',counterexample:['sent='+sent,'maySend returned '+maySend(sent)]}));process.exit(1)}}console.log('SendBound: all four real-source states checked; admission below2 unconstrained');\n");
 git(['init','-b','main']);git(['add','source.cjs','check.cjs']);git(['commit','-m','test: bounded send source']);const phases=[];
 for(const phase of ['create','maintain'] as const){
  const kind=phase==='create'?'create-formal-verification-skill':'maintain-formal-verification-skill',entry=workflowCatalog().find(e=>e.name===kind);if(!entry)throw Error('Pinned formal workflow missing');
  const command={id:'send-bound',executable:process.execPath,args:['check.cjs'],timeoutMs:15000,runner:'command',proof:{kind:'exit-code',reason:'Enumerate sent0..3 against real source, property-specific counterexample on excess admission'},input_scope:['check.cjs']};
  const spec=parseLocalCatalog({workflow:{id:id+'-'+phase,project,trustedCode:true,kind:'catalog',workflow:{name:kind,sha256:entry.sha256},paths:['source.cjs','check.cjs','.agents/skills'],write_scope:['.agents/skills'],checks:[command],task:`${phase} project-local verify-send skill for maySend source.cjs. Only product promise: integer sent 0..3, no send at or above2. Existing check.cjs exhaustively enumerates these states; no extra toolchain/model needed. Use actual frozen command ${process.execPath.replaceAll('\\','/')} check.cjs. Read source/check once, write compact SKILL.md and verification.json only (under500 words). Manifest coverage path source.cjs symbol maySend line${phase==='create'?1:2}; commandId send-bound; mutation before 'sent < 2' after 'sent <= 2'. Follow host supplied sourceCommit and requiredFrontmatter. ${phase==='maintain'?'Source gained comment only, behavior unchanged; inspect history before deciding in sync.':'Create new skill using native .agents/skills placement.'} No product edits or external files. Return exact outcome JSON after writes.`,rubric:['Real source boundary','Counterexample detects excess send','Native placement and sync history'],budget:{maxCalls:3,deadline,max_output_tokens:16384,max_input_bytes:1048576,max_output_bytes:262144}},operation:{kind,directory,coverage:['source.cjs'],commandId:'send-bound',failureSignal:'SendBound',verifierPaths:['check.cjs']}});
  const authority=authorizeExecution(store,localAuthoritySpec(spec),true),result=await runLocalCatalog(spec,{store,base:snapshot(store,project,spec.workflow.paths),root:join(work,phase),runtime:{agentDir:join(profileRoot('omp-system-dev'),'agent'),...provider},authorityId:authority.id});phases.push({phase,result});writeFileSync(join(work,'evidence.json'),JSON.stringify({passed:result.localVerified,phases,inference:true,scope:'Bounded actual-source enumeration, not unbounded proof or release certificate'},null,2));
  const consumers=store.list<{role:string;evidence:string}>('method-receipt').filter(r=>r.role==='formal-skill-consumer');assert(consumers.length>=1);for(const receipt of consumers){const recorded=JSON.parse(store.readArtifact(receipt.evidence).toString());assert(recorded.drives.length>0);assert(recorded.drives.every((c:any)=>c.id==='send-bound'&&c.status==='passed'));}
  if(!result.localVerified||!result.workspace)throw Error('Formal '+phase+' blocked: '+result.blockers.join('; '));
  assert.equal(readFileSync(join(project,'source.cjs'),'utf8'),phase==='create'?'exports.maySend = sent => sent < 2;\n':'// Same send bound; comment-only maintenance change.\nexports.maySend = sent => sent < 2;\n');
  mkdirSync(join(project,directory),{recursive:true});cpSync(join(result.workspace,directory),join(project,directory),{recursive:true});
  if(phase==='create'){git(['add',directory]);git(['commit','-m','test: generated verified send skill']);writeFileSync(join(project,'source.cjs'),'// Same send bound; comment-only maintenance change.\nexports.maySend = sent => sent < 2;\n');git(['add','source.cjs']);git(['commit','-m','test: comment-only source maintenance']);}
 }
 assert.deepEqual(protectedHashes(),before);console.log(JSON.stringify({passed:true,work,phases:phases.map(p=>({phase:p.phase,status:p.result.status})),protectedConfigUnchanged:true}));
}finally{provider.close();store.close();admission.release()}
