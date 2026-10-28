import {join} from 'node:path';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {root,profileRoot} from './dev-preflight';
import {openProvider} from '../src/provider';
import {Store} from '../src/state';
import {snapshot} from '../src/workspaces';
import {workflowCatalog} from '../src/catalog';
import {parseLocalCatalog,localAuthoritySpec,runLocalCatalog} from '../src/catalog-local';
import {authorizeExecution} from '../src/authority';
import {admitResources} from '../src/resource-admission';
// One parent admission, sequential operations, seven model calls maximum.
const selected=process.argv[2]??'prototype';if(!['prototype','hillclimb','both'].includes(selected))throw Error('Smoke requires prototype|hillclimb|both');
const deadline=Date.now()+180000,admission=await admitResources(root,true),provider=await openProvider(join(profileRoot('omp-system-dev'),'agent'));const reports:unknown[]=[];const id='local-'+randomUUID(),home=join(root,'.lab/workspaces',id);mkdirSync(home,{recursive:true});const evidence=join(home,'evidence.json');const watchdog=setTimeout(()=>{writeFileSync(evidence,JSON.stringify({passed:false,reason:'Global180s deadline',reports}));process.exit(1)},180000);
try{for(const kind of selected==='both'?['prototype','hillclimb']:[selected]){
 const project=join(home,kind);mkdirSync(project);const store=new Store(join(root,'.lab/state',id+'-'+kind));try{
 writeFileSync(join(project,'app.ts'),'export const value=9;');writeFileSync(join(project,'pin.ts'),'import {value} from "./app";const metric=process.argv.includes("contrast")?value+10:value;console.log(JSON.stringify({metric,errors:0,work:100}));if(value<0)process.exit(1)');
 const command={id:'actual',executable:process.execPath,args:['pin.ts'],timeoutMs:15000,runner:'command',proof:{kind:'exit-code',reason:'Actual CLI result and frozen numeric metric'},input_scope:['pin.ts']};const contrast={...command,id:'contrast',args:['pin.ts','contrast']};
 const operation=kind==='prototype'?{kind,decision:'Choose constant calculation shape',variants:['direct constant','small pure function'],surface:'cli',prerequisites:[]}:{kind,metric:command,sensitivity:contrast,minimumDelta:5,expectedWork:100,direction:'min',noise:0.1,samples:3,target:4,minAttempts:1,hypotheses:['Replace value 9 with value 4, preserving export']};
 const parsed=parseLocalCatalog({workflow:{id:id+'-'+kind,project,trustedCode:true,paths:['app.ts','pin.ts'],write_scope:['app.ts'],checks:kind==='hillclimb'?[command,contrast]:[command],task:'Change app.ts export value to 4. Keep pin.ts unchanged.',kind:'catalog',workflow:{name:kind,sha256:workflowCatalog().find(e=>e.name===kind)!.sha256},rubric:['Correct requested behavior','Frozen source integrity','Observed actual CLI behavior'],budget:{deadline,maxCalls:kind==='prototype'?12:16,max_output_tokens:16384,max_input_bytes:1048576,max_output_bytes:262144}},operation});
 const authority=authorizeExecution(store,localAuthoritySpec(parsed),true),result=await runLocalCatalog(parsed,{store,base:snapshot(store,project,parsed.workflow.paths),root:join(project,'scratch'),runtime:{agentDir:join(profileRoot('omp-system-dev'),'agent'),...provider},authorityId:authority.id});const sourceUntouched=readFileSync(join(project,'app.ts'),'utf8')==='export const value=9;';reports.push({kind,result,sourceUntouched});writeFileSync(evidence,JSON.stringify({passed:result.localVerified&&sourceUntouched,reports},null,2));if(!result.localVerified||!sourceUntouched){process.exitCode=1;break;}
 }finally{store.close();}
 }console.log(evidence);
}finally{clearTimeout(watchdog);provider.close();admission.release();}
