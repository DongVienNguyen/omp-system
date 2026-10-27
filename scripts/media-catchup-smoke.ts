import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,basename} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import puppeteer from 'puppeteer-core';
import {SessionManager} from '@oh-my-pi/pi-coding-agent';
import {getSessionsDir} from '@oh-my-pi/pi-utils';
import {Store} from '../src/state';
import {digest} from '../src/contracts';
import {sealEvidence} from '../src/evidence';
import {captureMediaCatchupHistory,runMediaCatchup} from '../src/media-catchup';
import {root,profileRoot,protectedHashes} from './dev-preflight';
import {admitResources} from '../src/resource-admission';
const [ffmpeg,ffprobe,browserExecutable]=process.argv.slice(2);if(!ffmpeg||!ffprobe||!browserExecutable)throw Error('Explicit FFmpeg/ffprobe/browser required');
const admission=await admitResources(root,true),before=protectedHashes(),id='catchup-'+randomUUID(),project=join(root,'.lab','workspaces',id);mkdirSync(project,{recursive:true});
const agentDir=join(profileRoot('omp-system-dev'),'agent'),store=new Store(join(agentDir,'omp-system',digest(project)));
const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body style="margin:0;background:#101820;color:white;font:26px sans-serif"><main style="padding:32px"><h1>Search preview</h1><label>Find item <input value="apple" style="font:24px sans-serif;width:160px"></label><div style="margin-top:24px;background:#3976b8;padding:16px">Apple juice</div></main></body></html>')});
try{
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('Loopback server missing');
 const browser=await puppeteer.launch({executablePath:browserExecutable,headless:true});try{const page=await browser.newPage();await page.setViewport({width:640,height:360,deviceScaleFactor:1});await page.goto('http://127.0.0.1:'+address.port,{waitUntil:'networkidle0'});assert.equal(await page.$eval('input',e=>(e as HTMLInputElement).value),'apple');assert.equal(await page.$eval('main div',e=>e.textContent),'Apple juice');await page.screenshot({path:join(project,'search.png'),type:'png'});}finally{await browser.close()}
 writeFileSync(join(project,'search-evidence.json'),JSON.stringify({surface:'owned loopback browser',input:'apple',visibleResult:'Apple juice',verified:true}));
 const paths=await import(import.meta.resolve('@oh-my-pi/pi-coding-agent/session/session-paths')),manager=SessionManager.create(project,paths.sessionDirForCwd(project,getSessionsDir(agentDir)));
 await manager.appendMessage({role:'user',content:'Build a search preview and ask before publishing.',timestamp:Date.now()});
 await manager.appendMessage({role:'assistant',content:[{type:'text',text:'Search preview captured and checked. Publishing remains unapproved.'}],api:'openai-completions',provider:'9router',model:'code-sol',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});
 await manager.appendMessage({role:'user',content:'/ketchup-video',timestamp:Date.now()});await manager.flush();
 const history=await captureMediaCatchupHistory({action:'session-history',id,project,mode:'read',session:basename(manager.getSessionFile()!),all:true,offset:0,limit:100,artifacts:[],deadline:Date.now()+30000},store,project);
 const rows=store.readArtifact(history.artifact).toString('utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(e=>e.type==='message'),invocation=rows.at(-1).id,now=history.capturedAt;
 sealEvidence(store,'review',id+'-source',{kind:'media-catchup-source',project,artifact:history.artifact,invocation,exactNativeSource:true,classifiedAt:now,events:rows.map(e=>({id:e.id,kind:e.message.role==='user'?'actual-user':'assistant'})),requests:['search'],outstandingCalls:['publish']});
 const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
 const request={action:'media-catchup',id,project,historyId:id,invocation,sourceReviewId:id+'-source',takeaway:'Search preview is ready for review, not published',remainingWork:'No further local work remains.',outcomes:[{requestId:'search',status:'not checked',waitingOnUser:true,claim:'Search preview awaits publishing approval',slide:0}],calls:[{id:'publish',requestId:'search',raisedAt:now,question:'Approve publishing search?',pick:'Review preview before approving publication.',items:[{name:'Search preview',change:'Typing apple shows Apple juice',evidence:{path:'search-evidence.json',sha256:hash(join(project,'search-evidence.json'))},evidenceSummary:'Actual browser input and visible result checked',risk:'Publishing changes behavior for users.'}],options:[]}],video:{action:'evidence-video',id:id+'-video',project,ffmpeg:{path:ffmpeg,sha256:hash(ffmpeg)},ffprobe:{path:ffprobe,sha256:hash(ffprobe)},slides:[{image:'search.png',sha256:hash(join(project,'search.png')),seconds:3,addedWords:0,claim:'Search preview awaits publishing approval',evidence:'search-evidence.json',evidenceSha256:hash(join(project,'search-evidence.json'))}],width:640,height:360,fps:24,deadline:Date.now()+90000}};
 Object.assign(request,{deadline:request.video.deadline});
 const imageArtifact=store.artifact(readFileSync(join(project,'search.png')));Object.assign(request.video.slides[0]!,{image:'outside-composition.png',imageArtifact});
 const content=await runMediaCatchup(request,store,project);assert.equal(content.status,'PENDING_REVIEW');
 // Host observed this owned fixture directly; not a model-generated content verdict.
 sealEvidence(store,'review',id+'-content',{kind:'media-catchup-content',project,packetDigest:content.packetDigest,reviewedAt:new Date().toISOString(),evidenceAndNarrativeValid:true});
 const publicSpec={...request,contentReviewId:id+'-content'},specFile=join(project,'catchup-request.json'),authority={id:randomUUID(),action:'catalog-operator',project,specDigest:digest(publicSpec),expires:request.video.deadline};writeFileSync(specFile,JSON.stringify(publicSpec));sealEvidence(store,'authority',authority.id,authority);
 const processResult=spawnSync(process.execPath,[join(root,'src/catalog-operator-cli.ts'),specFile,authority.id,project],{cwd:project,env:{...process.env,BUN_BE_BUN:'1',OMP_PROFILE:'omp-system-dev'},encoding:'utf8',timeout:100000});assert.equal(processResult.status,0,processResult.stderr);const result=JSON.parse(processResult.stdout);assert.equal(result.status,'PENDING_REVIEW');assert.equal(result.verified,false);assert.equal(result.reply,null);assert('rendered'in result);assert.deepEqual(protectedHashes(),before);
 const evidence={passed:true,id,project,store:store.directory,request:{...request,contentReviewId:id+'-content'},result,source:'Owned native SDK session fixture, not arbitrary user history',visualReview:'PENDING actual rendered frame inspection',inference:false};writeFileSync(join(project,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({passed:true,evidence:join(project,'evidence.json'),frame:join(store.artifacts,result.rendered.frames[0].artifact),video:result.rendered.video.path,packetDigest:result.packetDigest,inference:false}));
}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();admission.release()}
