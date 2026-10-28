import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {root,profileRoot,protectedHashes} from './dev-preflight';
import {admitResources} from '../src/resource-admission';
import {Store} from '../src/state';
import {openProvider} from '../src/provider';
import {snapshot} from '../src/workspaces';
import {workflowCatalog} from '../src/catalog';
import {parseLocalCatalog,runLocalCatalog,localAuthoritySpec} from '../src/catalog-local';
import {authorizeExecution} from '../src/authority';
const executable=process.argv[2];if(!executable)throw Error('Installed browser executable required');
const admission=await admitResources(root,true),id='browser-generated-'+randomUUID(),project=join(root,'.lab/workspaces',id);mkdirSync(project,{recursive:true});
const store=new Store(join(root,'.lab/state',id)),provider=await openProvider(join(profileRoot('omp-system-dev'),'agent')),before=protectedHashes();
try{
 writeFileSync(join(project,'index.html'),'<!doctype html><html><body>Unimplemented sketch</body></html>');
 writeFileSync(join(project,'pin.ts'),`import {readFileSync} from 'node:fs';const html=readFileSync('index.html','utf8');if(!html.toLowerCase().startsWith('<!doctype html>'))throw Error('HTML document required');console.log('HTML document present; exact selectors and behavior checked by native browser');`);
 const command={id:'surface',executable:process.execPath,args:['pin.ts'],timeoutMs:15000,runner:'command',proof:{kind:'exit-code',reason:'Frozen structural prerequisite only; actual browser interaction required separately'},input_scope:['pin.ts']};
 const entry=workflowCatalog().find(e=>e.name==='prototype')!,spec=parseLocalCatalog({workflow:{id,project,trustedCode:true,kind:'catalog',workflow:{name:'prototype',sha256:entry.sha256},paths:['index.html','pin.ts'],write_scope:['index.html'],checks:[command],task:'Build a throwaway note editor at index.html. Input id note, Save button id save, status paragraph id status. Native input and click must show exact Saved: Observed note. No external resources. Keep HTML under100 lines. Two directions must visibly differ in layout: compact single panel and spacious two-column preview. Do not change pin.ts.',rubric:['Required note interaction works','Directions visibly distinct','Self-contained accessible controls'],budget:{maxCalls:3,deadline:Date.now()+300000,max_output_tokens:16384,max_input_bytes:1048576,max_output_bytes:262144}},operation:{kind:'prototype',decision:'Choose compact or spacious note editing layout',variants:['Compact single panel','Spacious two-column preview'],surface:'browser',prerequisites:[],browser:{executable,entry:'index.html',width:900,height:560,actions:[{kind:'fill',selector:'#note',value:'Observed note'},{kind:'click',selector:'#save'},{kind:'expect-text',selector:'#status',value:'Saved: Observed note'}]}}});
 const authority=authorizeExecution(store,localAuthoritySpec(spec),true),result=await runLocalCatalog(spec,{store,base:snapshot(store,project,spec.workflow.paths),root:join(project,'scratch'),runtime:{agentDir:join(profileRoot('omp-system-dev'),'agent'),...provider},authorityId:authority.id});
 assert.deepEqual(protectedHashes(),before);assert.equal(readFileSync(join(project,'index.html'),'utf8'),'<!doctype html><html><body>Unimplemented sketch</body></html>');
 const evidence={passed:result.localVerified,project,result,inference:true,visualReview:'PENDING independent screenshots/design review; model text cannot inspect images through read-only text tools'};writeFileSync(join(project,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({passed:evidence.passed,project,blockers:result.blockers,store:store.directory,scope:'Actual generated variants and native browser actions; not production UI or automatic visual judgment'}));if(!result.localVerified)process.exitCode=1;
}finally{provider.close();store.close();admission.release()}
