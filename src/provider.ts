import { AuthStorage,ModelRegistry,Settings } from '@oh-my-pi/pi-coding-agent';
import { join } from 'node:path';
/** Profile-owned config only. Credential selectors resolve from caller process environment. */
export async function openProvider(agentDir:string){
 const authStorage=await AuthStorage.create(join(agentDir,'agent.db'));
 try{const modelRegistry=new ModelRegistry(authStorage,join(agentDir,'models.yml'),{settings:Settings.isolated({'memory.backend':'off','autolearn.enabled':false,'retry.fallbackChains':{}}),cacheDbPath:join(agentDir,'models.db')});return {authStorage,modelRegistry,close:()=>authStorage.close()}}
 catch(error){authStorage.close();throw error}
}
