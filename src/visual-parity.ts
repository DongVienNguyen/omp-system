import type {Browser} from 'puppeteer-core';
import {isAbsolute,resolve,join} from 'node:path';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {digest,safeRelative} from './contracts';
import {scoped} from './workspaces';
import type {Store} from './state';
import {sealEvidence,verifiedEvidence} from './evidence';
import {spawnSync} from 'node:child_process';
export type VisualRequest=({action:'visual-baseline'}|{action:'visual-compare'})&{id:string;project:string;baseline:string;browserExecutable:string;url:string;viewport:{width:number;height:number;deviceScaleFactor:number};components:{name:string;selector:string}[];harness:string[];deadline:number;};
export function validateVisualRequest(value:unknown,project:string):VisualRequest{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Visual object required');const v=value as Record<string,any>;
 if(Object.keys(v).some(k=>!['action','id','project','baseline','browserExecutable','url','viewport','components','harness','deadline'].includes(k))||!['visual-baseline','visual-compare'].includes(v.action)||typeof v.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v.id)||typeof v.baseline!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v.baseline)||typeof v.project!=='string'||resolve(v.project)!==resolve(project))throw Error('Visual identity required');
 if(typeof v.browserExecutable!=='string'||!isAbsolute(v.browserExecutable))throw Error('Explicit installed browser executable required');
 if(typeof v.url!=='string')throw Error('Loopback visual URL required');const url=new URL(v.url);if(url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.hash)throw Error('Loopback HTTP visual URL required');
 const viewport=v.viewport;if(!viewport||typeof viewport!=='object'||Array.isArray(viewport)||Object.keys(viewport).some(k=>!['width','height','deviceScaleFactor'].includes(k))||!Number.isInteger(viewport.width)||viewport.width<1||viewport.width>4096||!Number.isInteger(viewport.height)||viewport.height<1||viewport.height>4096||![1,2].includes(viewport.deviceScaleFactor))throw Error('Bounded exact viewport required');
 if(!Array.isArray(v.components)||!v.components.length||v.components.length>30||v.components.some((c:unknown)=>!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['name','selector'].includes(k))||!('name'in c)||typeof c.name!=='string'||!c.name.trim()||!('selector'in c)||typeof c.selector!=='string'||!c.selector.trim())||new Set(v.components.map((c:any)=>c.name)).size!==v.components.length)throw Error('Named component/state selectors required');
 if(!Array.isArray(v.harness)||!v.harness.length||v.harness.some((p:unknown)=>typeof p!=='string'))throw Error('Immutable harness read paths required');v.harness.forEach(safeRelative);
 if(!Number.isSafeInteger(v.deadline)||v.deadline<=Date.now())throw Error('Visual deadline required');return v as VisualRequest;
}
export async function runVisualParity(value:unknown,store:Store,project:string){
 const request=validateVisualRequest(value,project);if(store.get('catalog-operator',request.id))throw Error('Visual request ID already exists');
 const stored=store.get('visual-baseline',request.baseline);const existing=stored?verifiedEvidence<{identity:string;components:{name:string;artifact:string}[]}>(store,'check','visual-baseline:'+request.baseline):undefined;
 if(request.action==='visual-baseline'&&existing)throw Error('Visual baseline immutable; replacement denied');if(request.action==='visual-compare'&&!existing)throw Error('Pre-migration baseline missing');
 const pins=()=>request.harness.map(path=>({path,sha256:digest(readFileSync(scoped(project,path)).toString('base64'))})),initial=pins();
 const remaining=()=>{const ms=request.deadline-Date.now();if(ms<=0)throw Error('Visual deadline exhausted');return ms;};
 const [{default:puppeteer},{default:sharp}]=await Promise.all([import('puppeteer-core'),import('sharp')]);
 const profile=mkdtempSync(join(store.directory,'visual-profile-'));let browser:Browser;try{browser=await puppeteer.launch({executablePath:request.browserExecutable,userDataDir:profile,headless:true,timeout:remaining(),args:['--disable-background-networking','--disable-sync','--no-first-run']})}catch(error){rmSync(profile,{recursive:true,force:true});throw error}
 const killOwned=()=>{const child=browser.process();if(!child?.pid||child.exitCode!==null||child.signalCode!==null)return;if(process.platform==='win32'){const result=spawnSync('C:/Windows/System32/taskkill.exe',['/PID',String(child.pid),'/T','/F'],{encoding:'utf8',timeout:2000,windowsHide:true});if(result.status!==0&&child.exitCode===null)child.kill('SIGKILL')}else child.kill('SIGKILL')};
 const watchdog=setTimeout(killOwned,remaining());
 try{
  const identity=digest({project:resolve(project),browser:await browser.version(),url:request.url,viewport:request.viewport,components:request.components,harness:initial});if(existing&&existing.identity!==identity)throw Error('Visual surface/harness differs from immutable baseline');
  const page=await browser.newPage();await page.setViewport(request.viewport);page.setDefaultTimeout(remaining());await page.setRequestInterception(true);const origin=new URL(request.url).origin;
  page.on('request',r=>{let allowed=false;try{allowed=new URL(r.url()).origin===origin||r.url().startsWith('data:')}catch{}if(allowed)void r.continue();else void r.abort('blockedbyclient')});
  await page.goto(request.url,{waitUntil:'networkidle0',timeout:remaining()});await page.evaluate(()=>document.fonts.ready);const components:{name:string;artifact:string;width:number;height:number;differentPixels?:number;dimensionMismatch?:boolean;diffArtifact?:string}[]=[];
  for(const component of request.components){remaining();const elements=await page.$$(component.selector);if(elements.length!==1)throw Error('Component selector must match exactly once: '+component.name);const bytes=Buffer.from(await elements[0]!.screenshot({type:'png'}));const image=await sharp(bytes,{limitInputPixels:4096*4096*4}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
   const result:{name:string;artifact:string;width:number;height:number;differentPixels?:number;dimensionMismatch?:boolean;diffArtifact?:string}={name:component.name,artifact:store.artifact(bytes),width:image.info.width,height:image.info.height};
   if(existing){const original=existing.components.find(c=>c.name===component.name);if(!original)throw Error('Baseline component missing');const baseline=await sharp(store.readArtifact(original.artifact),{limitInputPixels:4096*4096*4}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    if(baseline.info.width!==image.info.width||baseline.info.height!==image.info.height){result.dimensionMismatch=true}else{const diff=Buffer.alloc(image.info.width*image.info.height*4);let different=0;for(let i=0;i<diff.length;i+=4){if(baseline.data[i]!==image.data[i]||baseline.data[i+1]!==image.data[i+1]||baseline.data[i+2]!==image.data[i+2]||baseline.data[i+3]!==image.data[i+3]){different++;diff[i]=255;diff[i+3]=255}}result.differentPixels=different;if(different)result.diffArtifact=store.artifact(await sharp(diff,{raw:{width:image.info.width,height:image.info.height,channels:4}}).png().toBuffer())}
   }components.push(result);
  }
  remaining();if(digest(initial)!==digest(pins()))throw Error('Visual harness changed during capture');
  const result={action:request.action,id:request.id,project:resolve(project),baseline:request.baseline,identity,components,status:existing?(components.every(c=>c.differentPixels===0)?'PIXEL_IDENTICAL':'PIXEL_DIFFERENT'):'BASELINE_CAPTURED',verified:!!existing&&components.every(c=>c.differentPixels===0),surface:'isolated-chromium',limitations:'Exact declared component/state pixels only; no migration or publishing authority granted.'};
  if(!existing)store.db.transaction(()=>{if(store.get('visual-baseline',request.baseline))throw Error('Visual baseline already exists');sealEvidence(store,'check','visual-baseline:'+request.baseline,result);store.put('visual-baseline',request.baseline,{identity})})();store.put('catalog-operator',request.id,result);return result;
 }finally{clearTimeout(watchdog);let closeTimer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([browser.close(),new Promise<never>((_,reject)=>{closeTimer=setTimeout(()=>{killOwned();reject(Error('Browser graceful shutdown exceeded 2s; owned process terminated'))},2000)})])}finally{if(closeTimer)clearTimeout(closeTimer);killOwned();rmSync(profile,{recursive:true,force:true,maxRetries:2,retryDelay:100})}}
}
