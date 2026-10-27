import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {Store} from '../src/state';
import {digest,type Check,type Review} from '../src/contracts';
import {snapshot} from '../src/workspaces';
import {certify} from '../src/gate';
import {sealEvidence,evidenceId} from '../src/evidence';
import {approvePromotion,promote,rollbackPromotion,freezeRegression} from '../src/promotion';
import {commandIdentity} from '../src/command-identity';
import {approveDelivery,exportVerified} from '../src/delivery';

test('selection cannot promote without independent regression and sealed authority; local export preserves exact bytes',()=>{
 const dir=mkdtempSync(join(import.meta.dir,'../.lab/promotion-')),work=join(dir,'work');mkdirSync(work);writeFileSync(join(work,'app.ts'),'export const value=42');const s=new Store(join(dir,'state'));
 try{
  const snap=snapshot(s,work,['app.ts']),candidate=snap.id,base=digest('base'),policy=digest('policy'),plan=digest('frozen regression');
  const check:Check={id:'test',candidate,policy,plan,status:'passed',exitCode:0,selectedTests:1,log:s.artifact('test observation42'),observation:'actual42'};
  sealEvidence(s,'check',evidenceId(candidate,'test'),{...check,runner:'bun-test',expectedTests:1});
  const review:Review={id:'review',candidate,base,policy,plan,session:'independent',implementerSession:'producer',status:'complete',reviewed_paths:['app.ts'],findings:[{id:'nonblocking',blocking:false,resolved:false,evidence:'Documented remaining risk'}]};sealEvidence(s,'review','review',review);
  const cert=certify(s,{candidate,base,policy,plan,requiredChecks:[{id:'test',requiresObservation:true}],paths:['app.ts'],checks:[check],review,pendingJobs:0,currentCandidate:()=>snapshot(s,work,['app.ts']).id});
  const command={id:'regression',executable:process.execPath,args:['test','regression.test.ts'],cwd:work,timeoutMs:10000,testCount:1};
  const frozen=freezeRegression(s,{project:work,experiment:'experiment',candidate,base,policy,plan,commands:[command],suite:{root:work,paths:['app.ts']}},true);
  const regressionId='regression:'+frozen.digest+':regression';sealEvidence(s,'check',evidenceId(candidate,regressionId),{...check,id:regressionId,plan:frozen.digest,runner:'bun-test',expectedTests:1,commandDigest:commandIdentity({...command,id:regressionId})});
  s.put('regression','experiment',{candidate,regressionDigest:frozen.digest});
  const authority=approvePromotion(s,{action:'promote',project:work,candidate,expires:Date.now()+60000},true);
  const request={project:work,experiment:'experiment',candidate,base,policy,plan,certificate:cert.id,authority:authority.id,frozenRegression:{digest:frozen.digest,evidence:['regression']},expectedActive:base};
  expect(()=>promote(s,{...request,authority:'invented'})).toThrow('Unattested');
  expect(()=>promote(s,{...request,frozenRegression:{...request.frozenRegression,evidence:[]}})).toThrow('coverage mismatch');
  expect(s.get('policy',work)).toBeUndefined();expect(promote(s,request).candidate).toBe(candidate);
  const rollback=approvePromotion(s,{action:'rollback',project:work,candidate,expires:Date.now()+60000},true);expect(rollbackPromotion(s,work,candidate,rollback.id).candidate).toBe(base);
  const dest=join(dir,'export');approveDelivery(s,{id:'delivery',action:'local-export',project:work,candidate,destination:dest,expires:Date.now()+60000},true);
  expect(exportVerified(s,{certificate:cert.id,candidate,base,policy,plan,authority:'delivery'}).scope).toBe('LOCAL_VERIFIED');
  expect(readFileSync(join(dest,'app.ts'),'utf8')).toBe('export const value=42');
  const handoff=JSON.parse(readFileSync(join(dest,'omp-system-delivery.json'),'utf8'));
  expect(handoff.certificate.id).toBe(cert.id);expect(handoff.candidate.id).toBe(candidate);expect(handoff.checks[0].id).toBe('test');expect(handoff.review.id).toBe(review.id);expect(handoff.unresolvedRisks[0].id).toBe('nonblocking');expect(handoff.authorizedActions[0].id).toBe('delivery');expect(handoff.remote).toBe('NOT RUN');expect(readFileSync(join(dest,'omp-system-evidence/check-0.log'),'utf8')).toBe('test observation42');
  expect(()=>exportVerified(s,{certificate:cert.id,candidate,base,policy,plan,authority:'delivery'})).toThrow('not empty');
  writeFileSync(join(work,'app.ts'),'mutated');expect(()=>promote(s,request)).toThrow('mutated');
 }finally{s.close();rmSync(dir,{recursive:true,force:true})}
},45000);
