import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {Store} from '../src/state';
import {digest,type Check,type Review} from '../src/contracts';
import {snapshot} from '../src/workspaces';
import {sealEvidence,evidenceId} from '../src/evidence';
import {certify} from '../src/gate';
import {resolveActiveHarness} from '../src/harness/active-policy';
import {executePromotionCommand} from '../src/promotion-command';

test('active certified harness bytes resolve at workflow start; conflicts fail closed and rollback restores prior baseline',async()=>{
 const dir=mkdtempSync(join(import.meta.dir,'../.lab/active-policy-')),s=new Store(join(dir,'state'));
 try{
  const make=(name:string,path:string,text:string,baseline=digest('base'))=>{
   const root=join(dir,name);mkdirSync(root);writeFileSync(join(root,path),text);const snap=snapshot(s,root,[path]),candidate=snap.id,base=baseline,policy=digest('policy'),plan=digest('plan');
   const check:Check={id:'test',candidate,policy,plan,status:'passed',exitCode:0,selectedTests:1,log:s.artifact('host test proof'),observation:'proof'};
   sealEvidence(s,'check',evidenceId(candidate,check.id),{...check,runner:'bun-test',expectedTests:1});
   const review:Review={id:'review-'+name,candidate,base,policy,plan,session:'reviewer',implementerSession:'author',status:'complete',reviewed_paths:[path],findings:[]};sealEvidence(s,'review',review.id,review);
   const cert=certify(s,{candidate,base,policy,plan,requiredChecks:[{id:check.id,requiresObservation:true}],paths:[path],checks:[check],review,pendingJobs:0,currentCandidate:()=>snapshot(s,root,[path]).id});
   return {candidate,certificate:cert.id,tree:{[path]:text}};
  };
  const old=make('old','SYSTEM.md','{"multiplier":1}'),next=make('next','SYSTEM.md','{"multiplier":2}',old.candidate),invalid=make('invalid','app.ts','export const x=1;');
  expect(resolveActiveHarness(s,dir,old.tree).policy).toBeNull();
  const suite=join(dir,'host-suite');mkdirSync(suite);writeFileSync(join(suite,'consumer.ts'),`import {readFileSync} from 'node:fs';export function run(input:number){const policy=JSON.parse(readFileSync(${JSON.stringify(join(dir,'next','SYSTEM.md'))},'utf8'));if(!Number.isFinite(policy.multiplier))throw Error('Invalid harness multiplier');return input*policy.multiplier}`);writeFileSync(join(suite,'frozen.test.ts'),`import {test,expect} from 'bun:test';import {run} from './consumer';test('harness consumer arithmetic behavior',()=>{expect(run(3)).toBe(6);expect(run(-2)).toBe(-4);expect(run(0)).toBe(0)});`);
  s.put('experiment','harness-promotion',{id:'harness-promotion',project:dir,selectedHarness:{candidate:next.candidate},source:'immutable-workflow-proof'});
  const proof=await executePromotionCommand(s,dir,{op:'freeze',project:dir,experiment:'harness-promotion',certificate:next.certificate,suite:{root:suite,paths:['frozen.test.ts','consumer.ts']},commands:[{id:'test',executable:process.execPath,args:['test','./frozen.test.ts'],cwd:suite,timeoutMs:15000,testCount:1}]},true);
  expect(s.get<{source:string}>('experiment','harness-promotion')?.source).toBe('immutable-workflow-proof');
  await expect(executePromotionCommand(s,dir,{op:'promote',project:dir,experiment:'harness-promotion',certificate:invalid.certificate,frozenRegression:proof,expectedActive:old.candidate},true)).rejects.toThrow('Unsupported harness surface');
  expect(s.get('policy',dir)).toBeUndefined();
  await executePromotionCommand(s,dir,{op:'promote',project:dir,experiment:'harness-promotion',certificate:next.certificate,frozenRegression:proof,expectedActive:old.candidate},true);
  const frozen=resolveActiveHarness(s,dir,next.tree);expect(frozen.tree).toEqual(next.tree);expect(frozen.policy?.candidate).toBe(next.candidate);
  expect(resolveActiveHarness(s,dir,undefined).tree).toEqual(next.tree);
  expect(()=>resolveActiveHarness(s,dir,old.tree)).toThrow('conflicts');
  await executePromotionCommand(s,dir,{op:'rollback',project:dir,expectedActive:next.candidate},true);
  expect(resolveActiveHarness(s,dir,old.tree).tree).toEqual(old.tree);expect(frozen.tree).toEqual(next.tree);
  s.put('policy',dir,{candidate:invalid.candidate,certificate:invalid.certificate});expect(()=>resolveActiveHarness(s,dir,invalid.tree)).toThrow('Unsupported harness surface');
  s.put('policy',dir,{candidate:old.candidate});expect(()=>resolveActiveHarness(s,dir,old.tree)).toThrow('certificate missing');
  s.put('policy',dir,{candidate:old.candidate,certificate:next.certificate});expect(()=>resolveActiveHarness(s,dir,old.tree)).toThrow('certificate mismatch');
  for(const value of [{op:'rollback',project:dir,expectedActive:next.candidate,authority:'invented'},{op:'rollback',project:join(dir,'other'),expectedActive:next.candidate}])await expect(executePromotionCommand(s,dir,value,true)).rejects.toThrow();
  await expect(executePromotionCommand(s,dir,{op:'rollback',project:dir,expectedActive:next.candidate},false)).rejects.toThrow('operator approval');
 }finally{s.close();rmSync(dir,{recursive:true,force:true})}
},60000);
