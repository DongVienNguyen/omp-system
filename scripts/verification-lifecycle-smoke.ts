import {join} from 'node:path';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {root,profileRoot,protectedHashes} from './dev-preflight';
import {Store} from '../src/state';
import {snapshot} from '../src/workspaces';
import {createMethodHost} from '../src/pstack-host';
import {runMethod} from '../src/pstack';
import {openProvider} from '../src/provider';
import {executeCheck} from '../src/checks';
import {digest} from '../src/contracts';
const before=protectedHashes(),id='verification-lifecycle-'+randomUUID(),work=join(root,'.lab','workspaces',id),source=join(work,'source');mkdirSync(source,{recursive:true});
writeFileSync(join(source,'app.ts'),'export const bounded=(n:number)=>Math.max(0,Math.min(10,n));\n');
writeFileSync(join(source,'app.test.ts'),"import {test,expect} from 'bun:test';import {bounded} from './app';test('boundaries',()=>{expect(bounded(-1)).toBe(0);expect(bounded(5)).toBe(5);expect(bounded(11)).toBe(10)});\n");
const paths=['app.ts','app.test.ts','verification'],writer=['verification'];
const provider=await openProvider(join(profileRoot('omp-system-dev'),'agent')),store=new Store(join(root,'.lab','state',id));
const outputs=['verification/verify-bounded/SKILL.md','verification/verify-bounded/features/README.md','verification/verify-bounded/features/boundaries.md'];
try{
 let project=source;const phases=[];
 for(const phase of ['create','maintain'] as const){
  const base=snapshot(store,project,paths),host=createMethodHost({tokenLimits:{max_output_tokens:16384,max_input_bytes:1048576,max_output_bytes:262144},store,base,root:join(work,phase),task:`${phase} verification for bounded(n). Write exactly ${outputs.join(', ')} using workspace tools. Operator selected project-local skill-root verification. Only these source/test/output paths readable; do not read directories or unavailable guides. Read app.ts/app.test.ts once; on maintain also read three existing output files. Then write each output once. Keep total generated text under 500 words; use brief runnable instructions, no repeated constraints or explanatory essay. SKILL frontmatter name verify-bounded and description; body Launch/Doctor/Drive/Evidence/Cleanup/Helpers. Library has no server. Launch/Drive exact command ${process.execPath.replaceAll('\\','/')} test app.test.ts in isolated checkout; Doctor read source/test, Evidence retain actual command output, Cleanup no server/process, Helpers none required. Feature README links boundaries.md. boundaries.md H2s exactly Sub-features / How to get to it (user POV) / Driving it with Bun / Gotchas. Feature behavior grounded in supplied tests. Do not modify implementation/tests. ${phase==='maintain'?'Add observed NaN propagation and existing test, preserve prior bounds.':'Create actual skill and both map files.'} Final reply at most two sentences after all files written.`,readScope:paths,writeScope:writer,checks:[{id:'bounds',executable:process.execPath,args:['test','app.test.ts'],cwd:project,timeoutMs:15000,testCount:phase==='create'?1:2}],runtime:{agentDir:join(profileRoot('omp-system-dev'),'agent'),...provider},maxCalls:1,deadline:Date.now()+240000,trustedCode:true});
  const result=await runMethod('verify',{task:`${phase} actual verification skill and feature map`,verificationMode:phase},host);if(!result.verified)throw Error('Verification behavior failed');
  const receipts=store.list<any>('method-receipt');const receipt=receipts.find(r=>r.role==='verification-map'&&r.evidence===result.selected!.evidence[0]);if(!receipt)throw Error('Generated artifact provenance absent');project=JSON.parse(store.readArtifact(receipt.evidence).toString()).workspace;
  for(const path of outputs){const body=readFileSync(join(project,path),'utf8');if(!body.trim())throw Error('Generated file missing '+path)}
  if(phase==='create'){writeFileSync(join(project,'app.test.ts'),readFileSync(join(project,'app.test.ts'),'utf8')+"test('NaN propagates',()=>expect(Number.isNaN(bounded(NaN))).toBe(true));\n");}
  phases.push({phase,result,workspace:project,outputs:outputs.map(path=>({path,content:readFileSync(join(project,path),'utf8')}))});
 }
 const proof=await executeCheck(store,{id:'drive-generated-map',executable:process.execPath,args:['test','app.test.ts'],cwd:project,timeoutMs:15000,testCount:2},{candidate:snapshot(store,project,paths).id,policy:digest('verification-frozen'),plan:digest('bounds-and-nan')},{trustedCode:true,root:project});
 if(proof.status!=='passed'||proof.selectedTests!==2)throw Error('Generated directions did not drive actual library');if(JSON.stringify(before)!==JSON.stringify(protectedHashes()))throw Error('Protected config drift');
 const evidence={passed:true,phases,drive:proof,scope:'Actual generated files and maintenance; generated native Bun drive executed. No quality score inferred from Markdown.'};writeFileSync(join(work,'evidence.json'),JSON.stringify(evidence,null,2),{flag:'wx'});console.log(JSON.stringify({passed:true,work,phases:phases.map(p=>p.phase),drive:proof.status}));
}finally{store.close();provider.close()}
