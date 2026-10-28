import {readFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {getAgentDir} from '@oh-my-pi/pi-utils';
import {Store} from './state';
import {digest} from './contracts';
import {verifiedEvidence} from './evidence';
import {openProvider} from './provider';
import {certifySelectedHarness} from './certify-harness';
const [file,approvalId,projectArg]=process.argv.slice(2);if(!file||!approvalId||!projectArg)throw Error('Certification file/authority/project required');const project=realpathSync(projectArg),spec:unknown=JSON.parse(readFileSync(file,'utf8')),agentDir=getAgentDir(),store=new Store(join(agentDir,'omp-system',digest(project)));
const approval=verifiedEvidence<any>(store,'authority',approvalId);if(approval.action!=='certify-harness'||approval.project!==project||approval.specDigest!==digest(spec)||approval.expires<=Date.now())throw Error('Harness certification authority mismatch');
const provider=await openProvider(agentDir);try{console.log(JSON.stringify(await certifySelectedHarness(store,project,spec,{agentDir,...provider})))}finally{provider.close();store.close()}
