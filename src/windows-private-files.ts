import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';

export type WindowsPrivacy = {path:string;private:boolean;protected:boolean;owner:string;currentSid:string;foreignAllowCount:number;icaclsExit:number|null;aclFingerprint:string};
export const windowsExecutable=(name:string)=>join(process.env.SystemRoot||'C:/Windows','System32',name);

/** Read-only, conservative ACL audit: unknown allow principals never count as private. */
export function inspectWindowsPrivacy(path:string):WindowsPrivacy {
 if(process.platform!=='win32')throw Error('Windows ACL inspection requires Windows');
 const script="$ErrorActionPreference='Stop';$p=$env:OMP_SYSTEM_PRIVATE_PATH;$a=Get-Acl -LiteralPath $p;$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$rules=@($a.Access|ForEach-Object{@{sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;allow=$_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow;rights=[int64]$_.FileSystemRights}});@{owner=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;currentSid=$sid;protected=$a.AreAccessRulesProtected;rules=$rules}|ConvertTo-Json -Depth 4 -Compress";
 const result=spawnSync(windowsExecutable('WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env:{...process.env,OMP_SYSTEM_PRIVATE_PATH:resolve(path)},encoding:'utf8',timeout:15000,windowsHide:true});
 if(result.status!==0)throw Error('Native Get-Acl inspection failed');
 const acl=JSON.parse(result.stdout) as {owner:string;currentSid:string;protected:boolean;rules:{sid:string;allow:boolean;rights:number}[]};
 if(!/^S-1-/.test(acl.currentSid)||!Array.isArray(acl.rules))throw Error('Malformed native ACL inspection');
 const allowed=new Set([acl.currentSid,'S-1-5-18','S-1-5-32-544']);
 const foreignAllowCount=acl.rules.filter(r=>r.allow&&r.rights!==0&&!allowed.has(r.sid)).length;
 const currentFull=acl.rules.some(r=>r.allow&&r.sid===acl.currentSid&&(r.rights&2032127)===2032127);
 const native=spawnSync(windowsExecutable('icacls.exe'),[resolve(path)],{encoding:'utf8',timeout:15000,windowsHide:true});
 return {path:resolve(path),private:allowed.has(acl.owner)&&currentFull&&foreignAllowCount===0&&native.status===0,protected:acl.protected,owner:acl.owner,currentSid:acl.currentSid,foreignAllowCount,icaclsExit:native.status,aclFingerprint:createHash('sha256').update(result.stdout).update(native.stdout??'').digest('hex')};
}
