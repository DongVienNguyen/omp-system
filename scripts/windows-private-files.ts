import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {inspectWindowsPrivacy,windowsExecutable} from '../src/windows-private-files';
import {root,profileRoot,verifyOwnership,within,assertRealComponents,preflight} from './dev-preflight';

/** ACL enforcement authority exists only for directory allocated by this call. */
export function createNewPrivateDirectory(parent:string,prefix:string){
 if(process.platform!=='win32')throw Error('Native private-directory proof requires Windows');
 if(!prefix||/[\\/]/.test(prefix))throw Error('Invalid private directory prefix');
 const base=[join(root,'.lab'),profileRoot('omp-system-install-test')].find(base=>within(base,parent));
 if(!base)throw Error('Private directory parent outside owned lab/install-test profile');
 verifyOwnership(base);assertRealComponents(parent);mkdirSync(parent,{recursive:true});
 const directory=mkdtempSync(join(resolve(parent),prefix)),before=inspectWindowsPrivacy(directory);
 if(!before.private){
  const sid=before.currentSid;
  const result=spawnSync(windowsExecutable('icacls.exe'),[directory,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F'],{encoding:'utf8',timeout:15000,windowsHide:true});
  if(result.status!==0)throw Error('New owned directory ACL enforcement failed');
 }
 const after=inspectWindowsPrivacy(directory);if(!after.private)throw Error('New owned directory remains non-private');
 return {directory,before,after,enforced:!before.private};
}

if(import.meta.main){
 preflight();
 const result=createNewPrivateDirectory(join(root,'.lab','state'),'ACL riêng tư ');
 const file=join(result.directory,'private-fixture.txt');writeFileSync(file,'non-secret isolated privacy fixture\n',{flag:'wx'});
 const filePrivacy=inspectWindowsPrivacy(file);if(!filePrivacy.private)throw Error('Private file inherited unsafe ACL');
 const evidence={...result,filePrivacy,inference:false,hosted:'NOT RUN'};writeFileSync(join(root,'.lab','evidence','windows-private-files.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}
