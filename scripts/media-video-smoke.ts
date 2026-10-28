import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {Store} from '../src/state';
import {digest} from '../src/contracts';
import {sealEvidence} from '../src/evidence';
import {root,profileRoot,childEnvironment,protectedHashes} from './dev-preflight';
import {admitResources} from '../src/resource-admission';
import {runEvidenceVideo} from '../src/media-video';
const [ffmpeg,ffprobe,browserExecutable]=process.argv.slice(2);if(!ffmpeg||!ffprobe||!browserExecutable)throw Error('Explicit verified FFmpeg/ffprobe/browser paths required');
const admission=await admitResources(root,true);let store:Store|undefined;let server:ReturnType<typeof createServer>|undefined;
try{
 const id='video-'+randomUUID(),project=join(root,'.lab','workspaces',id),before=protectedHashes();mkdirSync(project,{recursive:true});store=new Store(join(profileRoot('omp-system-dev'),'agent','omp-system',digest(project)));let changed=false;
 server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body style="margin:0;background:#101820;color:white;font:24px sans-serif"><main style="padding:24px"><h1 style="font-size:32px;margin:0 0 20px">Actual browser surface</h1><div style="width:220px;height:100px;background:'+(changed?'#e66b44':'#3976b8')+'"></div><p>'+(changed?'Changed card state':'Baseline card state')+'</p></main></body></html>')});await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('Server missing');
 const browser=await puppeteer.launch({executablePath:browserExecutable,headless:true});try{const page=await browser.newPage();await page.setViewport({width:640,height:360,deviceScaleFactor:1});for(let i=0;i<2;i++){changed=i===1;await page.goto('http://127.0.0.1:'+address.port,{waitUntil:'networkidle0'});await page.screenshot({path:join(project,'slide-'+i+'.png'),type:'png'});writeFileSync(join(project,'state-'+i+'.json'),JSON.stringify({captured:true,changed,surface:'actual-browser',url:'loopback fixture'}))}}finally{await browser.close()}
 const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex'),request={action:'evidence-video',id,project,ffmpeg:{path:ffmpeg,sha256:hash(ffmpeg)},ffprobe:{path:ffprobe,sha256:hash(ffprobe)},slides:[0,1].map(i=>({image:'slide-'+i+'.png',sha256:hash(join(project,'slide-'+i+'.png')),seconds:3,addedWords:8,claim:i?'Changed browser card state':'Baseline browser card state',evidence:'state-'+i+'.json',evidenceSha256:hash(join(project,'state-'+i+'.json'))})),width:640,height:360,fps:24,deadline:Date.now()+60000};
 const {default:sharp}=await import('sharp');writeFileSync(join(project,'disguised.png'),await sharp(join(project,'slide-0.png')).jpeg().toBuffer());await assert.rejects(runEvidenceVideo({...request,id:id+'-wrong-type',slides:[{...request.slides[0]!,image:'disguised.png',sha256:hash(join(project,'disguised.png'))}]},store,project),/bytes must be PNG/);
 const file=join(project,'request.json'),authority={id:randomUUID(),action:'catalog-operator',project,specDigest:digest(request),expires:request.deadline};writeFileSync(file,JSON.stringify(request));sealEvidence(store,'authority',authority.id,authority);const env:NodeJS.ProcessEnv={...childEnvironment('omp-system-dev'),BUN_BE_BUN:'1'};delete env.OMP_SYSTEM_API_KEY;
 const child=spawn(process.execPath,[join(root,'src','catalog-operator-cli.ts'),file,authority.id,project],{cwd:project,env,stdio:['ignore','pipe','pipe']});let output='',errors='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>errors+=b);const timer=setTimeout(()=>child.kill(),65000),exit=await new Promise<number|null>((resolve,reject)=>{child.once('close',resolve);child.once('error',reject)}).finally(()=>clearTimeout(timer));assert.equal(exit,0,errors+' '+output);const result=JSON.parse(output);assert.equal(result.video.durationSeconds,7);assert.equal(result.video.audioStreams,0);assert.equal(result.frames.length,2);assert.equal(result.verified,false);assert.deepEqual(protectedHashes(),before);
 const evidence={passed:true,project,result,protectedConfigUnchanged:true,inference:false,visualReview:'PENDING extracted frames must be inspected'};writeFileSync(join(project,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({passed:true,project,video:result.video.path,frames:result.frames.map((f:any)=>join(store!.artifacts,f.artifact)),duration:result.video.durationSeconds,inference:false}));
}finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));store?.close();admission.release()}
