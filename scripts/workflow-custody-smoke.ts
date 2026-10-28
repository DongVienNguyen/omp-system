import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {getAgentDir} from '@oh-my-pi/pi-utils';
import {root,profileRoot,protectedHashes} from './dev-preflight';
import {Store} from '../src/state';
import {digest} from '../src/contracts';
import {sealEvidence} from '../src/evidence';
import {parseWorkflow} from '../src/workflow-spec';
import plugin from '../src/extension';
assert.equal(realpathSync(getAgentDir()),realpathSync(join(profileRoot('omp-system-dev'),'agent')));
const before=protectedHashes(),project=mkdtempSync(join(root,'.lab/workspaces/workflow-custody-')),canonical=realpathSync(project),state=join(getAgentDir(),'omp-system',digest(canonical)),store=new Store(state);
try{
 const spec=parseWorkflow({id:'custody',project:canonical.replaceAll('\\','/'),trustedCode:true,paths:['app.ts'],write_scope:[],checks:[{id:'check',executable:process.execPath,args:['test','app.test.ts'],timeoutMs:1000,testCount:1}],task:'Read-only custody check',kind:'pstack',method:'how',budget:{deadline:Date.now()+30000,maxCalls:3,max_output_tokens:1024,max_input_bytes:65536,max_output_bytes:65536}});
 const file=join(project,'workflow.json');writeFileSync(file,JSON.stringify(spec));sealEvidence(store,'authority','custody',{action:'workflow',project:canonical,specDigest:digest(spec),expires:Date.now()+30000});store.put('method-result','custody',{verified:true,fixture:'Existing result must refuse before provider creation'});
 let handler:any,shutdown:any;plugin({registerCommand(_name:string,command:any){handler=command.handler},registerTool(){},on(name:string,fn:any){if(name==='session_shutdown')shutdown=fn}} as any);store.put('activation',canonical,{enabled:true,profile:'omp-system-dev'});try{await assert.rejects(()=>handler('workflow '+file,{cwd:canonical,ui:{notify(){}}}),/Workflow blocked\/failed/);const issued=store.list<any>('sealed-authority').map(r=>r.body).filter(r=>r.action==='workflow'&&typeof r.id==='string');assert.equal(issued.length,1);assert.equal(issued[0].project,canonical);assert.equal(issued[0].specDigest,digest(spec))}finally{shutdown?.()}
 const result=spawnSync(process.execPath,['src/workflow-cli.ts',file,'custody'],{cwd:root,env:{...process.env,BUN_BE_BUN:'1'},encoding:'utf8',timeout:20000});assert.notEqual(result.status,0);assert(result.stderr.includes('Workflow ID already exists'),result.stderr);assert(!result.stderr.includes('Unattested'));assert.deepEqual(protectedHashes(),before);console.log(JSON.stringify({passed:true,canonicalStoreResolved:true,duplicateRefusedBeforeInference:true,protectedUnchanged:true}));
}finally{store.close();rmSync(state,{recursive:true,force:true});rmSync(project,{recursive:true,force:true})}
