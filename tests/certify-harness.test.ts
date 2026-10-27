import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {Store} from '../src/state';
import {digest} from '../src/contracts';
import {snapshot} from '../src/workspaces';
import {certifySelectedHarness} from '../src/certify-harness';

test('harness production gate rejects unknown authority, missing producer and unbound acceptance before provider',async()=>{
 const dir=mkdtempSync(join(import.meta.dir,'../.lab/certify-boundary-')),s=new Store(join(dir,'state'));
 // These fail-closed cases must reject before touching provider runtime.
 const runtime:Parameters<typeof certifySelectedHarness>[3]=undefined!;
 try{
  const root=join(dir,'harness');mkdirSync(root);writeFileSync(join(root,'SYSTEM.md'),'Read scoped sources before editing.');const snap=snapshot(s,root,['SYSTEM.md']),tree={'SYSTEM.md':'Read scoped sources before editing.'},proof={candidate:snap.id,root,paths:['SYSTEM.md'],treeDigest:digest(tree),source:digest('app')};
  const request={tokenLimits:{max_output_tokens:16384,max_input_bytes:1048576,max_output_bytes:262144},experiment:'workflow',acceptanceRun:'acceptance',suite:{root:dir,paths:['harness/SYSTEM.md']},commands:[{id:'actual',executable:process.execPath,args:['test'],cwd:dir,timeoutMs:1000,testCount:1}],deadline:Date.now()+60000};
  await expect(certifySelectedHarness(s,dir,{...request,untrustedPassed:true},runtime)).rejects.toThrow('authority');
  await expect(certifySelectedHarness(s,dir,{...request,approvals:[{path:'scripts/run.ts',sha256:'0'.repeat(64),expires:Date.now()-1,purpose:'harness-surface'}]},runtime)).rejects.toThrow('approvals');
  await expect(certifySelectedHarness(s,dir,request,runtime)).rejects.toThrow('Eligible');
  const record={project:dir,task:'Task',source:proof.source,initialHarness:proof,selectedHarness:proof,selection:{ok:true,fallback:false,chosenLabel:'agg1'},receipts:[]};s.put('experiment','workflow',record);
  await expect(certifySelectedHarness(s,dir,request,runtime)).rejects.toThrow('producer session');
  s.put('experiment','workflow',{...record,receipts:[{id:'agg1',usage:{sessionId:'boundary-fixture'}}]});
  await expect(certifySelectedHarness(s,dir,request,runtime)).rejects.toThrow('acceptance rollout');
  s.put('rollout','acceptance',{workspace:dir,tree:{'SYSTEM.md':'different'},checks:[{status:'passed'}],outputs:[{path:'app.ts',content:'x'}]});
  await expect(certifySelectedHarness(s,dir,request,runtime)).rejects.toThrow('acceptance rollout');
  for(const binding of [{taskId:'unrelated-task',source:record.source},{taskId:'workflow',source:digest('unrelated-source')}]){s.put('rollout','acceptance',{...binding,workspace:dir,tree,checks:[{status:'passed'}],outputs:[{path:'app.ts',content:'x'}]});await expect(certifySelectedHarness(s,dir,request,runtime)).rejects.toThrow('acceptance rollout')}
  s.put('rollout','acceptance',{taskId:'workflow',source:record.source,workspace:dir,tree:{'SYSTEM.md':'different'},checks:[{status:'passed'}],outputs:[{path:'app.ts',content:'x'}]});
  writeFileSync(join(root,'SYSTEM.md'),'mutated');await expect(certifySelectedHarness(s,dir,request,runtime)).rejects.toThrow('changed');
  expect(s.list('certificate')).toHaveLength(0);
 }finally{s.close();rmSync(dir,{recursive:true,force:true})}
});
