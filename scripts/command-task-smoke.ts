import {join} from 'node:path';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {root,profileRoot} from './dev-preflight';
import {openProvider} from '../src/provider';
import {Store} from '../src/state';
import {Coordinator,type RunSpec} from '../src/coordinator';
import {authorizeExecution} from '../src/authority';
import {requireCertificate} from '../src/gate';
import {digest,type Certificate,type Check,type Review} from '../src/contracts';
import {admitResources} from '../src/resource-admission';
const admission=await admitResources(root,true),id='command-task-'+randomUUID(),project=join(root,'.lab','workspaces',id);mkdirSync(project,{recursive:true});
const original={title:'Install into isolated profile',command:{executable:'omp',args:['plugin','list']},network:false};writeFileSync(join(project,'install-guide.json'),JSON.stringify(original,null,2));
const validator=`import {readFileSync} from 'node:fs';
const guide=JSON.parse(readFileSync('install-guide.json','utf8'));
if(guide.title!=='Install into isolated profile'||guide.network!==false||guide.command?.executable!=='omp'||JSON.stringify(guide.command?.args)!==JSON.stringify(['--profile','omp-system-dev','plugin','list','--json'])){console.error(JSON.stringify({valid:false,reason:'Guide does not specify isolated offline JSON inventory'}));process.exit(1)}
console.log(JSON.stringify({valid:true,operation:'plugin-list',profile:guide.command.args[1],format:'json',network:guide.network}));
`;writeFileSync(join(project,'validate-guide.ts'),validator);
const provider=await openProvider(join(profileRoot('omp-system-dev'),'agent')),store=new Store(join(root,'.lab','state',id));
try{
 const spec:RunSpec={id,project,trustedCode:true,tasks:[{id:'docs',depends_on:[],goal:'Edit install-guide.json only. Preserve title and network:false. Set command.executable to omp and command.args to ["--profile","omp-system-dev","plugin","list","--json"], documenting isolated offline JSON plugin inventory. No other changes.',acceptance:['Guide decodes as JSON and describes offline omp --profile omp-system-dev plugin list --json','Native document validator returns valid:true with profile omp-system-dev and format json'],read_scope:['install-guide.json'],write_scope:['install-guide.json'],difficulty:'medium',state:'PLANNED',attempt:0,snapshot:''}],budget:{concurrency:1,max_worker_calls:2,max_rollouts:0,max_stages:0,max_transport_retries:0,max_repairs:0,deadline:Date.now()+180000,max_output_tokens:16384,max_input_bytes:1048576,max_output_bytes:262144},checks:{docs:[{id:'guide-cli',executable:process.execPath,args:['validate-guide.ts'],cwd:project,timeoutMs:15000,runner:'command',proof:{kind:'exit-code',reason:'Native JSON guide validator exits zero only for required isolated offline command contract'},input_scope:['validate-guide.ts']}]}};
 const coordinator=new Coordinator(store,{agentDir:join(profileRoot('omp-system-dev'),'agent'),...provider}),authority=authorizeExecution(store,spec,true),result=await coordinator.run(spec,authority.id),task=result.tasks.find(t=>t.id==='docs');
 const delivered=store.get<{snapshot:string;certificate:string;workspace:string}>('deliverable',id+':docs');if(task?.state!=='LOCAL_VERIFIED'||!delivered)throw Error('Command-proof docs task blocked: '+JSON.stringify(result));
 const certificate=store.get<Certificate>('certificate',delivered.certificate);if(!certificate)throw Error('Certificate missing');requireCertificate(store,certificate.id,certificate);
 const check=store.get<Check>('check',delivered.snapshot+':guide-cli'),review=store.get<Review>('review',certificate.review);if(check?.status!=='passed'||check.runner!=='command'||check.selectedTests!==null||!review?.reviewed_paths.includes('validate-guide.ts'))throw Error('Command proof/dependency reviewer coverage missing');
 const observed:unknown=JSON.parse(check.observation);if(!observed||typeof observed!=='object'||!('valid'in observed)||observed.valid!==true)throw Error('Native validator observation malformed');
 if(readFileSync(join(delivered.workspace,'validate-guide.ts'),'utf8')!==validator||readFileSync(join(project,'install-guide.json'),'utf8')!==JSON.stringify(original,null,2))throw Error('Frozen dependency or original source mutated');
 const evidence={passed:true,id,project,store:store.directory,certificate,check,review,result,resources:admission.resources,inputDependency:{path:'validate-guide.ts',sha256:digest(validator),producerReadable:false,reviewed:true},originalProjectUnchanged:true,inference:'medium producer and hard reviewer only; max2 worker calls'};writeFileSync(join(project,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}catch(error){const evidence={passed:false,id,project,store:store.directory,error:String(error),run:store.get('run',id),tasks:store.list('task'),dispatches:store.list('dispatch'),resources:admission.resources};writeFileSync(join(project,'evidence.json'),JSON.stringify(evidence,null,2));throw error}finally{store.close();provider.close();admission.release()}
