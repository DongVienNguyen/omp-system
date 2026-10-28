import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {root,profileRoot,protectedHashes} from './dev-preflight';
import {admitResources} from '../src/resource-admission';
import {installedAkInventory} from '../src/ak-inventory';
import {digest} from '../src/contracts';
import {Store} from '../src/state';
import {openProvider} from '../src/provider';
import {snapshot} from '../src/workspaces';
import {workflowCatalog} from '../src/catalog';
import {parseLocalCatalog,runLocalCatalog,localAuthoritySpec} from '../src/catalog-local';
import {authorizeExecution} from '../src/authority';
const python=process.argv[2];if(!python)throw Error('Installed validator Python required');
const admission=await admitResources(root,true),id='skill-author-'+randomUUID(),project=join(root,'.lab/workspaces',id);mkdirSync(project,{recursive:true});
const store=new Store(join(root,'.lab/state',id)),provider=await openProvider(join(profileRoot('omp-system-dev'),'agent')),before=protectedHashes();
try{
 writeFileSync(join(project,'app.ts'),'export const add=(a:number,b:number)=>a+b;\n');writeFileSync(join(project,'pin.ts'),'import {add} from "./app";const actual=add(2,3);if(actual!==5)throw Error("Real addition failed");console.log("Actual add(2,3) = "+actual);');
 const installed=installedAkInventory().entries.find(e=>e.kind==='skill'&&e.name==='ak-skill-creator'&&e.valid);if(!installed)throw Error('Installed authoring guide absent');const validator=join(installed.path,'..','scripts','quick_validate.py');
 const invocation={id:'actual-add',executable:process.execPath,args:['pin.ts'],timeoutMs:15000,runner:'command',proof:{kind:'exit-code',reason:'Actual imported addition result checked'},input_scope:['pin.ts']},entry=workflowCatalog().find(e=>e.name==='authoring-a-skill')!;
 const spec=parseLocalCatalog({workflow:{id,project,trustedCode:true,kind:'catalog',workflow:{name:entry.name,sha256:entry.sha256},paths:['app.ts','pin.ts','.agents/skills'],write_scope:['.agents/skills'],checks:[invocation],task:'Author .agents/skills/verify-add/SKILL.md for verifying library add(a,b). Native project root .agents/skills explicitly selected. Frontmatter name verify-add, description names addition verification request. Body under200 words: read project-cwd paths app.ts and pin.ts as plain code spans, not Markdown links or ../../../ resource paths. Run exact '+process.execPath.replaceAll('\\','/')+' pin.ts from project cwd, observe Actual add(2,3) = 5; no server, no external setup, no helper files needed. Skill resource links must remain inside skill directory; this skill needs none. Do not edit source or pin.ts. No PR authority. Cold consumer uses verification_drive ID actual-add.',rubric:['Runnable actual library verification','Native placement and specific trigger','No unavailable steps or source mutation'],budget:{maxCalls:5,deadline:Date.now()+300000,max_output_tokens:16384,max_input_bytes:1048576,max_output_bytes:262144}},operation:{kind:'authoring-a-skill',directory:'.agents/skills/verify-add',python,validatorSha256:digest(readFileSync(validator,'utf8')),invocation}});
 const authority=authorizeExecution(store,localAuthoritySpec(spec),true),result=await runLocalCatalog(spec,{store,base:snapshot(store,project,spec.workflow.paths),root:join(project,'scratch'),runtime:{agentDir:join(profileRoot('omp-system-dev'),'agent'),...provider},authorityId:authority.id});
 assert.deepEqual(protectedHashes(),before);writeFileSync(join(project,'evidence.json'),JSON.stringify({passed:result.localVerified,project,result,scope:'Actual generated native skill, pinned validator, cold-reader selected command; PR not authorized'},null,2));console.log(JSON.stringify({passed:result.localVerified,project,blockers:result.blockers}));if(!result.localVerified)process.exitCode=1;
}finally{provider.close();store.close();admission.release()}
