import { digest,type Command } from './contracts';
import {isAbsolute} from 'node:path';
/** cwd is supplied by owned snapshot materialization, never by worker output. */
export function commandIdentity(command:Command){return digest({id:command.id,executable:command.executable,args:command.args,timeoutMs:command.timeoutMs,testCount:command.testCount,noTestsReason:command.noTestsReason,runner:command.runner??'bun-test',proof:command.proof,input_scope:command.input_scope})}
/** Snapshot checks may not redirect execution to live or parent workspaces. */
export function assertSnapshotCommand(command:Command){for(const arg of command.args){const value=arg.includes('=')?arg.slice(arg.indexOf('=')+1):arg;if(isAbsolute(value)||/^[A-Za-z]:[\\/]|^\\\\/.test(value)||value.replaceAll('\\','/').split('/').includes('..')||/^--(?:cwd|root|dir|preload|require|eval|print)(?:=|$)/.test(arg)||['-e','-p','-r','-C'].includes(arg))throw Error('Snapshot check may not escape or redirect workspace');}if((command.runner??'bun-test')==='bun-test'&&command.args[0]!=='test')throw Error('Snapshot Bun test command required')}
