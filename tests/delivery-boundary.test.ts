import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Store} from '../src/state';
import {digest,type Check,type Review} from '../src/contracts';
import {snapshot} from '../src/workspaces';
import {certify} from '../src/gate';
import {sealEvidence,evidenceId} from '../src/evidence';
import {approveDelivery,prepareDeliveryBranch,bindDeliveryHead,pushVerified,observeGitHubChecks,createGitHubPullRequest,reconcileGitHubDelivery,type GitHubTransport} from '../src/delivery';
const head='a'.repeat(40);
function check(id:number,name='required',sha=head,status='completed',conclusion:string|null='success'){return {id,name,head_sha:sha,status,conclusion,started_at:status==='queued'?null:'2026-10-25T00:00:00Z',html_url:'https://github.com/o/r/check/'+id}}
function response(value:unknown,headers:Record<string,string>={}){return new Response(JSON.stringify(value),{headers})}

test('CI boundary follows all pages, newest pending run blocks old green, failures remain UNKNOWN',async()=>{
 const calls:string[]=[];
 const transport:GitHubTransport=async url=>{calls.push(url);return response({total_count:101,check_runs:url.endsWith('page=1')?Array.from({length:100},(_,i)=>check(i+1,'other')):[check(101)]},url.endsWith('page=1')?{link:'<https://api.github.com/repos/o/r/commits/'+head+'/check-runs?filter=latest&page=2&per_page=100>; rel="next"'}:{})};
 expect((await observeGitHubChecks({repository:'o/r',head,token:'boundary',required:['required']},transport)).scope).toBe('REMOTE_VERIFIED');expect(calls.length).toBe(2);
 const pending:GitHubTransport=async()=>response({total_count:2,check_runs:[check(1),check(2,'required',head,'queued',null)]});expect((await observeGitHubChecks({repository:'o/r',head,token:'boundary',required:['required']},pending)).scope).toBe('REMOTE_BLOCKED');
 const stale:GitHubTransport=async()=>response({total_count:1,check_runs:[check(1,'required','b'.repeat(40))]});expect((await observeGitHubChecks({repository:'o/r',head,token:'boundary',required:['required']},stale)).scope).toBe('UNKNOWN');
 const denied:GitHubTransport=async()=>new Response('denied',{status:403});expect((await observeGitHubChecks({repository:'o/r',head,token:'boundary',required:['required']},denied)).scope).toBe('UNKNOWN');
 const incomplete:GitHubTransport=async()=>response({total_count:1,check_runs:[]});expect((await observeGitHubChecks({repository:'o/r',head,token:'boundary',required:['required']},incomplete)).scope).toBe('UNKNOWN');
});

test('real local Git head binding, sealed separate PR approval, and stale-head reconciliation boundary',async()=>{
 const dir=mkdtempSync(join(import.meta.dir,'../.lab/delivery-')),root=join(dir,'work');mkdirSync(root);const store=new Store(join(dir,'state'));
 const git=(args:string[])=>{const r=spawnSync('git',['-C',root,...args],{encoding:'utf8',timeout:10000,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'}});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim()};
 try{
  git(['init']);git(['config','user.name','Local Delivery Check']);git(['config','user.email','delivery@example.invalid']);git(['config','core.autocrlf','false']);writeFileSync(join(root,'app.ts'),'export const n=42;\n');git(['add','app.ts']);git(['commit','-m','local fixture']);
  const sha=git(['rev-parse','HEAD']),snap=snapshot(store,root,['app.ts']),candidate=snap.id,base=digest('base'),policy=digest('policy'),plan=digest('plan');
  const c:Check={id:'test',candidate,policy,plan,status:'passed',exitCode:0,selectedTests:1,log:store.artifact('boundary fixture evidence, not hosted integration'),observation:'fixture'};sealEvidence(store,'check',evidenceId(candidate,c.id),{...c,runner:'bun-test',expectedTests:1});
  const review:Review={id:'review',candidate,base,policy,plan,session:'reviewer',implementerSession:'producer',status:'complete',reviewed_paths:['app.ts'],findings:[]};sealEvidence(store,'review',review.id,review);
  const cert=certify(store,{candidate,base,policy,plan,requiredChecks:[{id:c.id,requiresObservation:true}],paths:['app.ts'],checks:[c],review,pendingJobs:0,currentCandidate:()=>snapshot(store,root,['app.ts']).id});
  const expires=Date.now()+60000,input={certificate:cert.id,candidate,base,policy,plan,authority:'push'};
  approveDelivery(store,{id:'push',action:'push',project:root,candidate,destination:'https://github.com/o/r.git',expires,head:sha,branch:'delivery'},true);
  const binding=bindDeliveryHead(store,input);expect(binding.head).toBe(sha);expect(bindDeliveryHead(store,input).id).toBe(binding.id);
  expect(()=>approveDelivery(store,{id:'bad',action:'push',project:root,candidate,destination:'--force',expires,head:sha,branch:'delivery'},true)).toThrow('destination');
  expect(()=>approveDelivery(store,{id:'push',action:'push',project:root,candidate,destination:'https://github.com/o/r.git',expires,head:sha,branch:'delivery'},true)).toThrow('already sealed');
  let called=0;const forbidden:GitHubTransport=async()=>{called++;throw Error('unexpected')};await expect(createGitHubPullRequest(store,{...input,binding:binding.id,pushReceipt:'invented',token:'boundary'},forbidden)).rejects.toThrow('authority mismatch');expect(called).toBe(0);
  approveDelivery(store,{id:'pr',action:'pull-request',project:root,candidate,destination:'https://api.github.com/repos/o/r/pulls',expires,head:sha,branch:'delivery',repository:'o/r',baseBranch:'main',title:'Exact title',body:'Exact approved body',requiredChecks:['required']},true);
  // Inject only transport + host-sealed boundary receipt. This does not prove hosted push/PR integration.
  sealEvidence(store,'authority','delivery-push:fixture',{id:'fixture',action:'push-receipt',binding:binding.id,head:sha,branch:'delivery',destination:'https://github.com/o/r.git'});
  const prData={number:7,html_url:'https://github.com/o/r/pull/7',head:{sha,ref:'delivery',repo:{full_name:'o/r'}},base:{ref:'main',repo:{full_name:'o/r'}}};
  const apiCalls:{url:string;method:string;body:unknown}[]=[];
  const transport:GitHubTransport=async(url,init)=>{apiCalls.push({url,method:init.method??'GET',body:init.body});if(init.method==='POST')return response(prData);if(url.includes('/check-runs'))return response({total_count:1,check_runs:[check(1,'required',sha)]});if(url.includes('/pulls/7'))return response(prData);return response({object:{sha}})};
  const pr=await createGitHubPullRequest(store,{...input,authority:'pr',binding:binding.id,pushReceipt:'fixture',token:'boundary'},transport);
  expect(JSON.parse(String(apiCalls.find(c=>c.method==='POST')?.body))).toEqual({title:'Exact title',body:'Exact approved body',head:'delivery',base:'main'});
  const reconcile={...input,authority:'pr',binding:binding.id,pullRequest:pr.id,token:'boundary',required:['required']};expect((await reconcileGitHubDelivery(store,reconcile,transport)).scope).toBe('REMOTE_VERIFIED');
  expect((await reconcileGitHubDelivery(store,{...reconcile,required:['easier']},forbidden)).scope).toBe('UNKNOWN');
  let observed=false;const changed:GitHubTransport=async(url,init)=>{if(url.includes('/check-runs')){observed=true;return response({total_count:1,check_runs:[check(1,'required',sha)]})}if(url.includes('/pulls/7'))return response({...prData,head:{...prData.head,sha:observed?'b'.repeat(40):sha}});return transport(url,init)};
  expect((await reconcileGitHubDelivery(store,reconcile,changed)).scope).toBe('UNKNOWN');expect(store.get<{scope:string}>('delivery-reconciliation',binding.id)?.scope).toBe('UNKNOWN');
  writeFileSync(join(root,'app.ts'),'changed');expect(()=>pushVerified(store,{...input,binding:binding.id})).toThrow('mutated');
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
},120000);

test('explicit preparation commits non-Git candidate without touching original staged or unstaged bytes',()=>{
 const dir=mkdtempSync(join(import.meta.dir,'../.lab/prepare-')),root=join(dir,'repository'),candidateRoot=join(dir,'candidate');mkdirSync(root);mkdirSync(candidateRoot);const store=new Store(join(dir,'state'));
 const git=(cwd:string,args:string[])=>{const r=spawnSync('git',['-C',cwd,...args],{encoding:'utf8',timeout:10000,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'}});if(r.status!==0)throw Error(r.stderr);return r.stdout};
 try{
  git(root,['init']);git(root,['config','user.name','Local Preparation']);git(root,['config','user.email','prepare@example.invalid']);git(root,['config','core.autocrlf','false']);writeFileSync(join(root,'app.ts'),'base\n');writeFileSync(join(root,'delete.ts'),'remove\n');git(root,['add','.']);git(root,['commit','-m','base']);const baseHead=git(root,['rev-parse','HEAD']).trim();
  writeFileSync(join(root,'app.ts'),'staged\n');git(root,['add','app.ts']);writeFileSync(join(root,'app.ts'),'unstaged\n');writeFileSync(join(root,'untracked.txt'),'keep\n');const index=git(root,['ls-files','--stage','-z']),status=git(root,['status','--porcelain=v1','--untracked-files=all']);
  writeFileSync(join(candidateRoot,'app.ts'),'certified\n');const snap=snapshot(store,candidateRoot,['app.ts','delete.ts']),candidate=snap.id,base=digest('base'),policy=digest('policy'),plan=digest('plan');
  const check:Check={id:'check',candidate,policy,plan,status:'passed',exitCode:0,selectedTests:1,log:store.artifact('local boundary fixture'),observation:'boundary only'};sealEvidence(store,'check',evidenceId(candidate,check.id),{...check,runner:'bun-test',expectedTests:1});const review:Review={id:'review',candidate,base,policy,plan,session:'reviewer',implementerSession:'producer',status:'complete',reviewed_paths:['app.ts'],findings:[]};sealEvidence(store,'review',review.id,review);const cert=certify(store,{candidate,base,policy,plan,requiredChecks:[{id:'check',requiresObservation:true}],paths:['app.ts'],checks:[check],review,pendingJobs:0,currentCandidate:()=>snapshot(store,candidateRoot,snap.scope).id});
  const authority={id:'prepare',action:'prepare-branch' as const,project:candidateRoot,candidate,destination:join(dir,'prepared'),expires:Date.now()+60000,repositoryRoot:root,baseHead,branch:'prepared',authorName:'Local Preparation',authorEmail:'prepare@example.invalid',message:'Exact certified candidate'};approveDelivery(store,authority,true);const input={certificate:cert.id,candidate,base,policy,plan,authority:authority.id};const binding=prepareDeliveryBranch(store,input);
  expect(binding.worktree).toBe(authority.destination);expect(git(binding.worktree!,['ls-tree','-r','--name-only',binding.head])).toBe('app.ts\n');expect(readFileSync(join(binding.worktree!,'app.ts'),'utf8')).toBe('certified\n');expect(git(binding.worktree!,['rev-parse','HEAD^']).trim()).toBe(baseHead);expect(git(binding.worktree!,['status','--porcelain'])).toBe('');
  expect(git(root,['rev-parse','HEAD']).trim()).toBe(baseHead);expect(git(root,['ls-files','--stage','-z'])).toBe(index);expect(git(root,['status','--porcelain=v1','--untracked-files=all'])).toBe(status);expect(readFileSync(join(root,'app.ts'),'utf8')).toBe('unstaged\n');expect(readFileSync(join(root,'untracked.txt'),'utf8')).toBe('keep\n');expect(()=>prepareDeliveryBranch(store,input)).toThrow('must not exist');
  approveDelivery(store,{id:'push-prepared',action:'push',project:candidateRoot,candidate,destination:'https://github.com/o/r.git',expires:Date.now()+60000,head:binding.head,branch:'prepared'},true);
  const push=()=>pushVerified(store,{...input,authority:'push-prepared',binding:binding.id});
  git(root,['config','url.https://unapproved.invalid/.pushInsteadOf','https://github.com/']);expect(push).toThrow('Unsafe effective Git delivery configuration');expect(store.get('delivery-action','push-prepared')).toBeUndefined();git(root,['config','--remove-section','url.https://unapproved.invalid/']);
  const included=join(dir,'included.gitconfig');writeFileSync(included,'[url "https://unapproved.invalid/"]\n    insteadOf = https://github.com/\n');git(root,['config','include.path',included]);expect(push).toThrow('Unsafe effective Git delivery configuration');expect(store.get('delivery-action','push-prepared')).toBeUndefined();git(root,['config','--unset','include.path']);
  git(root,['config','extensions.worktreeConfig','true']);git(binding.worktree!,['config','--worktree','url.https://unapproved.invalid/.insteadOf','https://github.com/']);expect(push).toThrow('Unsafe effective Git delivery configuration');expect(store.get('delivery-action','push-prepared')).toBeUndefined();
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
},120000);
