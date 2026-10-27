import { mkdirSync,writeFileSync,readFileSync,lstatSync,existsSync } from 'node:fs';
import { join,dirname } from 'node:path';
import { digest,safeRelative } from '../contracts';
import { scoped } from '../workspaces';
import { assertClean,type Tree } from './recursion';
import { requireExecutableApproval,type ExecutableApproval } from './executable-authority';
export const surfaceNames=['system_prompt','guardrails','memory','tool_guidance','subagents','skills','scripts','plugins'] as const;
export type SurfaceName=typeof surfaceNames[number];
const ownerPaths:Record<SurfaceName,string[]>={system_prompt:['SYSTEM.md'],guardrails:['GUARDRAILS.md'],memory:['EXPERIENCE.md'],tool_guidance:['TOOLS.md'],subagents:['agents/'],skills:['skills/'],scripts:['scripts/'],plugins:['plugins/']};
export interface Materialized {root:string;fingerprint:string;tree:Tree;prompt:string;extensions:string[];skills:{path:string;content:string}[];agents:{path:string;content:string}[];scripts:string[];}
export function classifySurface(path:string):SurfaceName{safeRelative(path);for(const name of surfaceNames)if(ownerPaths[name].some(p=>p.endsWith('/')?path.startsWith(p):path===p))return name;throw Error('Unsupported harness surface '+path)}
export function validateSurfaceTree(tree:Tree,authority:{executableCodeTrusted:boolean;approvals?:readonly ExecutableApproval[]}){
 assertClean(tree);const paths=Object.keys(tree);if(!paths.length)throw Error('Empty surface tree');let chars=0;
 for(const p of paths){const name=classifySurface(p);if(typeof tree[p]!=='string')throw Error('Text surface required');chars+=tree[p].length;if(chars>2*1024*1024)throw Error('Harness tree exceeds cap');if(name==='plugins'||name==='scripts'){if(!authority.executableCodeTrusted)throw Error('Executable surface BLOCKED without explicit trust or OS sandbox');requireExecutableApproval(p,tree[p],authority.approvals??[])}if(name==='plugins'&&!/^plugins\/[a-z][a-z0-9-]*\.ts$/.test(p))throw Error('Invalid plugin path');if(name==='subagents'&&!/^agents\/[a-z][a-z0-9-]*\.md$/.test(p))throw Error('Invalid agent path');if(name==='scripts'&&!/^scripts\/[a-z][a-z0-9-]*\.(ts|js|py)$/.test(p))throw Error('Invalid script path');}
}
export function materialise(tree:Tree,destination:string,authority:{executableCodeTrusted:boolean;approvals?:readonly ExecutableApproval[]}):Materialized{
 validateSurfaceTree(tree,authority);if(existsSync(destination))throw Error('Surface destination already exists');mkdirSync(destination,{recursive:true});
 const result:Materialized={root:destination,fingerprint:digest(tree),tree,prompt:'',extensions:[],skills:[],agents:[],scripts:[]};
 for(const [name,text]of Object.entries(tree)){const path=scoped(destination,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text,{flag:'wx',mode:0o600});switch(classifySurface(name)){case 'system_prompt':case 'guardrails':case 'memory':case 'tool_guidance':result.prompt+='\n\n# '+name+'\n'+text;break;case 'plugins':result.extensions.push(path);break;case 'skills':result.skills.push({path,content:text});break;case 'subagents':result.agents.push({path,content:text});break;case 'scripts':result.scripts.push(path);break}}
 return result;
}
