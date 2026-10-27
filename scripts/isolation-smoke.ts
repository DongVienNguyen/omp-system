import { mkdirSync,readFileSync,writeFileSync,readdirSync } from 'node:fs';
import { join,relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { root,preflight,childEnvironment,profileRoot,protectedHashes } from './dev-preflight';
const before=protectedHashes();preflight();const source=join(process.env.USERPROFILE!,'.omp','agent');const dest=join(root,'.lab','ak-snapshot');mkdirSync(dest,{recursive:true});
const ownership=JSON.parse(readFileSync(join(process.env.USERPROFILE!,'.agentkit','adapters','omp','engineer','omp-ownership.json'),'utf8'));
const selected=ownership.claims.filter((c:any)=>{const p=relative(source,c.path).replaceAll('\\','/');return /^(skills|agents|rules)\//.test(p)&&p.endsWith('.md')});
const manifest=[];for(const c of selected){const p=relative(source,c.path);const bytes=readFileSync(c.path);const hash=createHash('sha256').update(bytes).digest('hex');if(hash!==c.sha256)throw Error('AK managed source changed');const target=join(dest,p);mkdirSync(join(target,'..'),{recursive:true});writeFileSync(target,bytes);manifest.push({path:p,sha256:hash})}
writeFileSync(join(dest,'manifest.json'),JSON.stringify(manifest));
const dirs=[];for(const name of ['omp-system-dev','omp-system-install-test']){const env=childEnvironment(name);const r=spawnSync(process.execPath,['-e',"import {getAgentDir,getPluginsDir} from '@oh-my-pi/pi-utils';console.log(JSON.stringify({agent:getAgentDir(),plugins:getPluginsDir()}))"],{cwd:root,env:{...env,BUN_BE_BUN:'1'},encoding:'utf8',timeout:15000});if(r.status!==0)throw Error('Profile path query failed');const actual=JSON.parse(r.stdout.trim());if(!actual.agent.startsWith(profileRoot(name))||!actual.plugins.startsWith(profileRoot(name)))throw Error('Profile path leak');dirs.push(actual)}
if(JSON.stringify(before)!==JSON.stringify(protectedHashes()))throw Error('Protected settings drift');console.log(JSON.stringify({profiles:dirs,akFiles:manifest.length,globalConfigUnchanged:true,sharedScopes:'native session-owner and daemon base roots remain shared; lab never starts broad runtime services'}));
