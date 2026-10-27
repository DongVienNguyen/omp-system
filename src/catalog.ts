import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {digest} from './contracts';
import {resolveAkInstructions,akInstructionContext,type AkSelection} from './ak-inventory';
export interface CatalogEntry {name:string;path:string;sha256:string;kind:'principle'|'playbook'|'skill';}
const root=new URL('../vendor/pstack/skills/',import.meta.url);
export function workflowCatalog():CatalogEntry[]{
 const entries:CatalogEntry[]=[];
 for(const name of readdirSync(root)){const path=new URL(name+'/SKILL.md',root);try{const body=readFileSync(path,'utf8');entries.push({name,path:fileURLToPath(path),sha256:digest(body),kind:name.startsWith('principle-')?'principle':'skill'})}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'&&(error as NodeJS.ErrnoException).code!=='ENOTDIR')throw error}}
 const playbooks=new URL('poteto-mode/playbooks/',root);
 for(const name of readdirSync(playbooks)){const path=new URL(name,playbooks);if(name.endsWith('.md')&&lstatSync(path).isFile())entries.push({name:name.slice(0,-3),path:fileURLToPath(path),sha256:digest(readFileSync(path,'utf8')),kind:'playbook'})}
 return entries.sort((a,b)=>a.name.localeCompare(b.name));
}
export function loadWorkflow(name:string,expectedHash?:string){if(!/^[a-z][a-z0-9-]*$/.test(name))throw Error('Invalid workflow name');const entries=workflowCatalog().filter(e=>e.name===name);if(entries.length!==1)throw Error('Unknown or ambiguous workflow');const entry=entries[0]!;if(expectedHash&&entry.sha256!==expectedHash)throw Error('Workflow content changed');return {entry,content:readFileSync(entry.path,'utf8')}}
/** Resolve only exact packaged relative references and exact catalog identities, never ambient paths. */
export function resolveWorkflowInstructions(name:string,hash:string,selection?:AkSelection){
 const loaded=loadWorkflow(name,hash),sources:{path:string;sha256:string;content:string}[]=[],seen=new Set<string>(),missing:string[]=[];
 const base=fileURLToPath(root),inventory=workflowCatalog();
 const visit=(path:string)=>{path=resolve(path);if(seen.has(path))return;seen.add(path);const rel=relative(base,path);if(isAbsolute(rel)||rel.startsWith('..')){missing.push('Reference outside pinned skills: '+path);return}let content:string;try{content=readFileSync(path,'utf8')}catch{missing.push('Missing pinned reference: '+path);return}sources.push({path,sha256:digest(content),content});
  for(const m of content.matchAll(/\]\((\.\.?\/[^) #]+\.md)(?:#[^) ]*)?\)/g))visit(resolve(dirname(path),m[1]!));
  for(const m of content.matchAll(/\*\*([a-z][a-z0-9-]+)\*\*|`([a-z][a-z0-9-]+)`/g)){const n=m[1]??m[2],matches=inventory.filter(e=>e.name===n||e.name==='principle-'+n);if(matches.length===1)visit(matches[0]!.path)}
 };
 visit(loaded.entry.path);
 if(name==='authoring-a-skill')visit(resolve(base,'poteto-mode/references/omp-create-skill.md'));
 // Core method and style dependencies are implicit named prose in pinned playbooks.
 if(loaded.entry.kind==='playbook')for(const n of name==='investigation'?['how','why','unslop']:name==='bug-fix'?['how','why','architect','interrogate']:name==='refactoring'?['how','architect','interrogate']:[]){const e=inventory.find(e=>e.name===n);if(e)visit(e.path);else missing.push('Missing pinned dependency: '+n)}
 const ak=selection?resolveAkInstructions(selection):undefined,akContext=ak?akInstructionContext(ak):'';
 return {loaded,sources,missing,fingerprint:digest({sources:sources.map(({path,sha256})=>({path,sha256})),ak:ak?.fingerprint??null}),content:sources.map(s=>'# '+s.path+' ['+s.sha256+']\n'+s.content).join('\n\n')+akContext,akFingerprint:ak?.fingerprint};
}
