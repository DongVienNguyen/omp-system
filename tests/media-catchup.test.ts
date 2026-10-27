import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Store} from '../src/state';
import {sealEvidence} from '../src/evidence';
import {parseMediaCatchup,runMediaCatchup,catchupCalls} from '../src/media-catchup';

// Runnable: bun tests/media-catchup.test.ts. Fixtures represent host-reviewed native
// attribution, never a caller's role claim. No renderer/process/provider executed.
const root=mkdtempSync(join(tmpdir(),'media-catchup-')),project=join(root,'project');mkdirSync(project);
const store=new Store(join(root,'store')),now=new Date().toISOString();
const bytes=Buffer.from('actual diff evidence'),hash=createHash('sha256').update(bytes).digest('hex');writeFileSync(join(project,'diff.txt'),bytes);
const events=[{id:'old',kind:'actual-user'},{id:'earlier',kind:'actual-user'},{id:'last',kind:'actual-user'},{id:'notice',kind:'notification'},{id:'work',kind:'assistant'},{id:'current',kind:'actual-user'}];
const rows=events.map(e=>({type:'message',id:e.id,message:{role:e.kind==='assistant'?'assistant':'user',content:e.id==='current'?'/ketchup-video':e.id==='earlier'?'/ketchup':'text'}}));
 // Outstanding approval predates last actual user message; notifications must not reset window.
 const callRaisedAt=new Date(Date.now()-86400000).toISOString();
const artifact=store.artifact(rows.map(e=>JSON.stringify(e)).join('\n'));
sealEvidence(store,'authority','media-catchup-history-history',{kind:'media-catchup-history',project,artifact,session:'session',capturedAt:now});
const source={kind:'media-catchup-source',project,artifact,invocation:'current',exactNativeSource:false,classifiedAt:now,events,requests:['feature'],outstandingCalls:['approve']};
sealEvidence(store,'review','source',source);
const request={action:'media-catchup',id:'catchup',project,historyId:'history',invocation:'current',sourceReviewId:'source',takeaway:'Feature needs your approval',remainingWork:'No work remains for me.',outcomes:[{requestId:'feature',status:'not checked',waitingOnUser:true,claim:'Feature awaits approval',slide:0}],calls:[{id:'approve',requestId:'feature',raisedAt:callRaisedAt,question:'Approve feature?',pick:'Review change before approval.',items:[{name:'Feature',change:'New search behavior',evidence:{path:'diff.txt',sha256:hash},evidenceSummary:'Actual diff is available for review',risk:'Search behavior changes.'}],options:[]}],video:{action:'evidence-video',id:'catchup-video',project,ffmpeg:{path:join(root,'missing-ffmpeg'),sha256:hash},ffprobe:{path:join(root,'missing-ffprobe'),sha256:hash},slides:[{image:'slide.png',sha256:hash,seconds:3,addedWords:3,claim:'Feature awaits approval',evidence:'diff.txt',evidenceSha256:hash}],width:640,height:360,fps:24,deadline:Date.now()+60000}};
Object.assign(request,{deadline:request.video.deadline});
try{
 assert.equal(parseMediaCatchup(request,project).calls.length,1);
 assert.match(catchupCalls([{...request.calls[0]!,items:[{...request.calls[0]!.items[0]!,pick:'Hold this item until data review'}]}]),/Pick: Hold this item until data review/);
 const linked=(link:string)=>({...request,calls:[{...request.calls[0]!,items:[{...request.calls[0]!.items[0]!,link}]}]});
 assert.throws(()=>parseMediaCatchup(linked('https://example.test/\n\n<video src="unreviewed"></video>'),project),/Unsafe call link/);
 assert(!catchupCalls(linked('https://example.test/<video>').calls).includes('<video>'));
 const pending=await runMediaCatchup(request,store,project);assert.equal(pending.status,'PENDING_REVIEW');assert.equal(pending.verified,false);assert.deepEqual(pending.window,{after:'last',before:'current',entries:['notice','work']});assert.equal(pending.reply,null);
 assert.throws(()=>parseMediaCatchup({...request,role:'user'},project),/Unknown/);
 assert.throws(()=>parseMediaCatchup({...request,outcomes:[{...request.outcomes[0],status:'done'}]},project),/outcome/);
 await assert.rejects(runMediaCatchup({...request,calls:[]},store,project),/outstanding/);
 await assert.rejects(runMediaCatchup({...request,calls:[{...request.calls[0],raisedAt:'2026-02-30T00:00:00.000Z'}]},store,project),/date/);
 await assert.rejects(runMediaCatchup({...request,video:{...request.video,slides:[{...request.video.slides[0],evidenceSha256:'0'.repeat(64)}]}},store,project),/evidence changed/);
 sealEvidence(store,'review','source',{...source,exactNativeSource:true});
 const contentPending=await runMediaCatchup(request,store,project);assert.equal(contentPending.status,'PENDING_REVIEW');
 sealEvidence(store,'review','content',{kind:'media-catchup-content',project,packetDigest:contentPending.packetDigest,reviewedAt:now,evidenceAndNarrativeValid:true});
 const failed=await runMediaCatchup({...request,contentReviewId:'content'},store,project);assert.equal(failed.status,'RENDER_FAILED');assert.equal(failed.verified,false);assert(failed.reply?.startsWith('Video render failed.\n- Approve feature?'));assert(!failed.reply?.includes('No work remains'));assert(!failed.reply?.includes('!['));
 // Host-owned renderer fixture tests review gate without claiming fixture is real video.
 const videoArtifact=store.artifact('fixture-not-video'),frameArtifact=store.artifact('fixture-not-frame');
 const rendered={video:{artifact:videoArtifact,path:join(store.directory,'video.mp4')},frames:[{artifact:frameArtifact,actualHoldSeconds:3}]};store.put('media-catchup','catchup',{packetDigest:contentPending.packetDigest,rendered});
 const visualPending=await runMediaCatchup({...request,contentReviewId:'content'},store,project);assert.equal(visualPending.status,'PENDING_REVIEW');assert.equal(visualPending.verified,false);assert.equal(visualPending.reply,null);
 sealEvidence(store,'review','visual',{kind:'media-catchup-visual',project,packetDigest:contentPending.packetDigest,videoArtifact:'0'.repeat(64),reviewedAt:now,method:'manual',frames:[]});
 await assert.rejects(runMediaCatchup({...request,contentReviewId:'content',visualReviewId:'visual'},store,project),/binding mismatch/);
 sealEvidence(store,'review','source',{...source,exactNativeSource:true,events:events.map(e=>e.id==='notice'?{...e,id:'invented'}:e)});
 await assert.rejects(runMediaCatchup(request,store,project),/frozen native messages/);
 sealEvidence(store,'review','source',{...source,exactNativeSource:true,requests:[],outstandingCalls:[]});
 const empty={...request,id:'empty',outcomes:[],calls:[],video:undefined};const emptyPending=await runMediaCatchup(empty,store,project);
 sealEvidence(store,'review','empty-content',{kind:'media-catchup-content',project,packetDigest:emptyPending.packetDigest,reviewedAt:now,evidenceAndNarrativeValid:true});
 const emptyResult=await runMediaCatchup({...empty,contentReviewId:'empty-content'},store,project);assert.equal(emptyResult.verified,true);assert.equal(emptyResult.reply,'Nothing changed and nothing waits on you.');
 await assert.rejects(runMediaCatchup({...empty,id:'catchup'},store,project),/already bound/);
 await assert.rejects(runMediaCatchup({...empty,takeaway:'Different reviewed content'},store,project),/already bound/);
 console.log('media-catchup: window, pre-window user calls, pending status, render failure and evidence/review rejection assertions passed');
}finally{store.close();rmSync(root,{recursive:true,force:true})}
