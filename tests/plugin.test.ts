import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import plugin from '../src/extension';
import type {ExtensionAPI} from '@oh-my-pi/pi-coding-agent';
import {Store} from '../src/state';
import {digest} from '../src/contracts';
import {getAgentDir} from '@oh-my-pi/pi-utils';

test('one extension factory keeps project status separate and rejects activation without verified diagnostics',async()=>{
 const first=mkdtempSync(join(import.meta.dir,'../.lab/plugin-one-')),second=mkdtempSync(join(import.meta.dir,'../.lab/plugin-two-'));
 type Context={cwd:string;ui:{notify(text:string):void}};
 let command:{handler(args:string,ctx:Context):Promise<void>}|undefined,shutdown:(()=>void)|undefined;
 const api={registerCommand(_name:string,c:{handler(args:string,ctx:Context):Promise<void>}){command=c},registerTool(){},on(name:string,fn:()=>void){if(name==='session_shutdown')shutdown=fn}};
 // Registration seam only; doctor uses real profile/version/list/config checks, never fake diagnostics.
 plugin(api as unknown as ExtensionAPI);
 const results:{enabled:boolean;project:string}[]=[],ctx=(cwd:string):Context=>({cwd,ui:{notify(text:string){results.push(JSON.parse(text))}}});
 try{
  if(!command)throw Error('Command registration absent');
  await expect(command.handler('enable',ctx(first))).rejects.toThrow();
  await command.handler('status',ctx(first));await command.handler('status',ctx(second));
  expect(results[0]?.enabled).toBe(false);expect(results[1]?.enabled).toBe(false);expect(results[0]?.project).not.toBe(results[1]?.project);
  await command.handler('disable',ctx(first));await command.handler('status',ctx(second));expect(results[2]?.enabled).toBe(false);expect(results[3]?.enabled).toBe(false);
  const s=new Store(join(getAgentDir(),'omp-system',digest(realpathSync(first))));try{s.put('activation',realpathSync(first),{enabled:true,profile:'foreign-profile'});await command.handler('status',ctx(first));expect(results.at(-1)?.enabled).toBe(false);await expect(command.handler('wake-arm absent.json',ctx(first))).rejects.toThrow('current project/profile')}finally{s.close()}
 }finally{shutdown?.();rmSync(first,{recursive:true,force:true});rmSync(second,{recursive:true,force:true})}
},45000);
