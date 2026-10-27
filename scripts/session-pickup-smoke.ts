import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,basename} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {SessionManager} from '@oh-my-pi/pi-coding-agent';
import {getSessionsDir} from '@oh-my-pi/pi-utils';
import {Store} from '../src/state';
import {digest} from '../src/contracts';
import {sealEvidence} from '../src/evidence';
import {root,profileRoot,childEnvironment,protectedHashes} from './dev-preflight';
import {admitResources} from '../src/resource-admission';
const admission=await admitResources(root,true);let store:Store|undefined;
try{
 const id='pickup-'+randomUUID(),project=join(root,'.lab','workspaces',id),agentDir=join(profileRoot('omp-system-dev'),'agent'),before=protectedHashes();mkdirSync(project,{recursive:true});
 const paths=await import(import.meta.resolve('@oh-my-pi/pi-coding-agent/session/session-paths')),bucket=paths.sessionDirForCwd(project,getSessionsDir(agentDir)),manager=SessionManager.create(project,bucket);
 await manager.appendMessage({role:'user',content:'Continue only pending work; do not rerun verified repro.',timestamp:Date.now()});await manager.appendMessage({role:'assistant',content:[{type:'text',text:'Inherited result: actual sum is 5. Pending: documentation.'}],api:'openai-completions',provider:'9router',model:'code-sol',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});await manager.flush();
 const session=manager.getSessionFile()!,original=readFileSync(session),artifact='actual sum = 5\n';writeFileSync(join(project,'result.txt'),artifact);store=new Store(join(agentDir,'omp-system',digest(project)));
 const request={action:'session-history',id,project,mode:'read',session:basename(session),all:false,offset:0,limit:10,artifacts:[{path:'result.txt',sha256:createHash('sha256').update(artifact).digest('hex')}],deadline:Date.now()+20000},file=join(project,'request.json'),authority={id:randomUUID(),action:'catalog-operator',project,specDigest:digest(request),expires:request.deadline};writeFileSync(file,JSON.stringify(request));sealEvidence(store,'authority',authority.id,authority);
 const env:NodeJS.ProcessEnv={...childEnvironment('omp-system-dev'),BUN_BE_BUN:'1'};delete env.OMP_SYSTEM_API_KEY;const child=spawnSync(process.execPath,[join(root,'src','catalog-operator-cli.ts'),file,authority.id,project],{cwd:project,env,encoding:'utf8',timeout:25000});assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);assert(result.text.includes('Pending: documentation'));assert.equal(result.inheritedArtifactsValid,true);assert.equal(result.reexecuted,false);assert(readFileSync(session).equals(original));assert.deepEqual(protectedHashes(),before);
 const evidence={passed:true,project,session:basename(session),result,sourceUnchanged:true,protectedConfigUnchanged:true,inference:false};writeFileSync(join(project,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({passed:true,project,returnedMessages:result.returnedMessages,sourceUnchanged:true,inference:false}));
}finally{store?.close();admission.release()}
