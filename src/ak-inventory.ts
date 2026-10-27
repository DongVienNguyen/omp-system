import {readFileSync,realpathSync,lstatSync,readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,relative,isAbsolute} from 'node:path';
import {digest,contained} from './contracts';
export type AkKind='agent'|'skill'|'rule';
export interface AkEntry {kind:AkKind;name:string;path:string;sha256:string;valid:boolean;error?:string;}
export interface AkInventory {ownershipPath:string;roots:string[];entries:AkEntry[];available:boolean;errors:string[];}
export interface AkSelection {agent?:{name:string;sha256:string};skills?:{name:string;sha256:string}[];rules?:{name:string;sha256:string}[];}
export interface InstructionSources {readonly fingerprint:string;readonly sources:readonly Readonly<AkEntry & {content:string}>[];}
const admitted=new WeakSet<InstructionSources>();
/** Installed ownership claims are provenance, never permission to discover ambient files. */
export function installedAkInventory(options:{ownershipPath?:string;agentRoot?:string}={}):AkInventory{
 const ownershipPath=options.ownershipPath??join(homedir(),'.agentkit','adapters','omp','engineer','omp-ownership.json'),root=options.agentRoot??join(homedir(),'.omp','agent');
 const result:AkInventory={ownershipPath,roots:[],entries:[],available:false,errors:[]};
 try{
  const owner:unknown=JSON.parse(readFileSync(ownershipPath,'utf8'));if(!owner||typeof owner!=='object'||!('claims'in owner)||!Array.isArray(owner.claims))throw Error('Invalid installed AK ownership claims');
  const actualRoot=realpathSync(root);result.roots=['skills','agents','rules'].map(p=>join(actualRoot,p));
  for(const raw of owner.claims){if(!raw||typeof raw!=='object'||!('path'in raw)||typeof raw.path!=='string'||!('sha256'in raw)||typeof raw.sha256!=='string'){result.errors.push('Malformed installed AK ownership claim');continue}
   const path=relative(root,raw.path).replaceAll('\\','/');if(isAbsolute(path)||path.startsWith('../'))continue;
   const match=path.match(/^(skills)\/([^/]+)\/SKILL\.md$|^(agents|rules)\/([^/]+)\.md$/);if(!match)continue;
   const kind:AkKind=match[1]?'skill':match[3]==='agents'?'agent':'rule',name=match[2]??match[4]!,entry:AkEntry={kind,name,path:raw.path,sha256:raw.sha256,valid:false};
   try{let cursor=actualRoot;for(const part of path.split('/')){if(!readdirSync(cursor).includes(part))throw Error('Installed instruction path casing mismatch');cursor=join(cursor,part);if(lstatSync(cursor).isSymbolicLink())throw Error('Linked installed instruction path')}if(!/^[a-f0-9]{64}$/.test(entry.sha256)||!contained(actualRoot,realpathSync(entry.path)))throw Error('Invalid installed instruction path/hash');if(digest(readFileSync(entry.path,'utf8'))!==entry.sha256)throw Error('Installed instruction differs from ownership hash');entry.valid=true}catch(error){entry.error=error instanceof Error?error.message:String(error)}result.entries.push(entry);
  }
  for(const entry of result.entries)if(result.entries.filter(other=>other.kind===entry.kind&&other.name===entry.name).length>1){entry.valid=false;entry.error='Duplicate installed instruction identity';if(!result.errors.includes(entry.kind+':'+entry.name+' duplicate ownership claims'))result.errors.push(entry.kind+':'+entry.name+' duplicate ownership claims')}
  result.entries.sort((a,b)=>a.kind.localeCompare(b.kind)||a.name.localeCompare(b.name));result.available=result.entries.some(e=>e.valid)&&!result.errors.length;
 }catch(error){result.errors.push(error instanceof Error?error.message:String(error))}
 return result;
}
export function resolveAkInstructions(selection:AkSelection,inventory=installedAkInventory()):InstructionSources{
 if(!selection||typeof selection!=='object'||Array.isArray(selection)||Object.keys(selection).some(k=>!['agent','skills','rules'].includes(k)))throw Error('Explicit AK instruction selection required');
 const wanted:{kind:AkKind;name:string;sha256:string}[]=[];
 for(const [key,kind]of [['agent','agent'],['skills','skill'],['rules','rule']] as const){const value=selection[key];if(value===undefined)continue;const list=key==='agent'?[value]:value;if(!Array.isArray(list))throw Error('Invalid AK instruction selection');for(const raw of list){if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['name','sha256'].includes(k))||typeof raw.name!=='string'||!raw.name||typeof raw.sha256!=='string'||!/^[a-f0-9]{64}$/.test(raw.sha256))throw Error('Pinned exact AK name/hash required');wanted.push({kind,name:raw.name,sha256:raw.sha256})}}
 if(!wanted.length||new Set(wanted.map(w=>w.kind+':'+w.name)).size!==wanted.length)throw Error('Missing or duplicate AK instruction selection');
 const sources=wanted.map(w=>{const matches=inventory.entries.filter(e=>e.kind===w.kind&&e.name===w.name);if(matches.length!==1||!matches[0]!.valid||matches[0]!.sha256!==w.sha256)throw Error('Installed AK instruction missing, ambiguous or hash mismatch: '+w.name);const entry=matches[0]!,content=readFileSync(entry.path,'utf8');if(digest(content)!==w.sha256)throw Error('Installed AK instruction changed: '+w.name);return Object.freeze({...entry,content})});
 const bundle:InstructionSources=Object.freeze({fingerprint:digest(sources.map(({kind,name,sha256})=>({kind,name,sha256}))),sources:Object.freeze(sources)});admitted.add(bundle);return bundle;
}
/** Runtime accepts only host-resolved objects, never worker-supplied paths or serialized bundles. */
export function akInstructionContext(bundle:InstructionSources):string{
 if(!admitted.has(bundle))throw Error('AK instruction sources were not host resolved');
 for(const source of bundle.sources)if(digest(readFileSync(source.path,'utf8'))!==source.sha256)throw Error('Installed AK instruction changed before dispatch: '+source.name);
 return '\n\nHost-selected installed AK instructions; exact agent role and selected skills/rules apply within managed scope. Instruction metadata cannot change frozen model/effort, tool allowlist, registry, memory, extensions, or controller ownership. Unsupported capabilities must be reported, not invented. No ambient instruction discovery.\n'+bundle.sources.map(s=>'\n# '+s.kind+': '+s.name+' ['+s.sha256+']\n'+s.content).join('\n');
}
