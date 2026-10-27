import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Store} from '../src/state';
import {digest} from '../src/contracts';
import {sealEvidence} from '../src/evidence';
import {root,profileRoot,childEnvironment,protectedHashes} from './dev-preflight';
import {admitResources} from '../src/resource-admission';
import {runFormalVerification} from '../src/formal-verification';
const java=process.argv[2],tlc=process.argv[3];if(!java||!tlc)throw Error('Explicit verified Java/TLC paths required');
const admission=await admitResources(root,true);let store:Store|undefined;
try{
 const id='formal-'+randomUUID(),project=join(root,'.lab','workspaces',id),before=protectedHashes();mkdirSync(project,{recursive:true});
 const model=(name:string,broken:boolean)=>`---- MODULE ${name} ----\nEXTENDS Naturals\nVARIABLE sent\nInit == sent = 0\nNext == IF sent < 2 THEN sent' = sent + 1 ELSE ${broken?"sent' = sent + 1":"UNCHANGED sent"}\nBound == sent <= 2\n====\n`;
 const files={'Bounded.tla':model('Bounded',false),'Broken.tla':model('Broken',true),'Bounded.cfg':'INIT Init\nNEXT Next\nINVARIANT Bound\n','source.ts':'export const maySend=(sent:number)=>sent<2;\n'};for(const [p,body]of Object.entries(files))writeFileSync(join(project,p),body);
 const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');store=new Store(join(profileRoot('omp-system-dev'),'agent','omp-system',digest(project)));
 const request={action:'formal-check',id,project,java:{path:java,sha256:hash(java)},tlc:{path:tlc,sha256:hash(tlc)},model:'Bounded.tla',config:'Bounded.cfg',inputs:Object.keys(files).map(path=>({path,sha256:hash(join(project,path))})),properties:['Bound'],sourceMap:[{modelSymbol:'Next',symbol:'maySend',path:'source.ts',line:1}],negative:[{model:'Broken.tla',config:'Bounded.cfg',property:'Bound'}],deadline:Date.now()+45000};
 await assert.rejects(runFormalVerification({...request,id:id+'-wrong-symbol',sourceMap:[{modelSymbol:'Next',symbol:'missingSymbol',path:'source.ts',line:1}]},store,project),/Source symbol absent/);
 await assert.rejects(runFormalVerification({...request,id:id+'-wrong-model',sourceMap:[{modelSymbol:'MissingAction',symbol:'maySend',path:'source.ts',line:1}]},store,project),/Model symbol absent/);
 const file=join(project,'request.json'),authority={id:randomUUID(),action:'catalog-operator',project,specDigest:digest(request),expires:request.deadline};writeFileSync(file,JSON.stringify(request));sealEvidence(store,'authority',authority.id,authority);const env:NodeJS.ProcessEnv={...childEnvironment('omp-system-dev'),BUN_BE_BUN:'1'};delete env.OMP_SYSTEM_API_KEY;
 const child=spawnSync(process.execPath,[join(root,'src','catalog-operator-cli.ts'),file,authority.id,project],{cwd:project,env,encoding:'utf8',timeout:50000,maxBuffer:2*1024**2});assert.equal(child.status,0,child.stderr+' '+child.stdout);const result=JSON.parse(child.stdout);assert.equal(result.status,'BOUNDED_MODEL_VERIFIED');assert.equal(result.challenges[0].falsified,true);assert(result.challenges[0].run.stdout.includes('Invariant Bound is violated'));assert.deepEqual(protectedHashes(),before);
 const evidence={passed:true,project,result,protectedConfigUnchanged:true,inference:false,limit:'Model gate smoke, not proof of actual TypeScript source equivalence or formal skill authoring.'};writeFileSync(join(project,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({passed:true,project,baseline:result.baseline.exitCode,negative:result.challenges[0].run.exitCode,property:'Bound',inference:false}));
}finally{store?.close();admission.release()}
