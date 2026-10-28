param([Parameter(Mandatory=$true)][string]$Request)
$ErrorActionPreference = 'Stop'
# Native Job Object owns all descendants even after original parent exits.
# PowerShell's bundled C# compiler is used; no global toolchain installation.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class OmpOwnedJob {
 [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a,b,c,d,e,f; }
 [StructLayout(LayoutKind.Sequential)] struct BASIC { public long PerProcessUserTimeLimit,PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize,MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass,SchedulingClass; }
 [StructLayout(LayoutKind.Sequential)] struct EXTENDED { public BASIC BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed; }
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct STARTUP { public uint cb; public string reserved,desktop,title; public uint x,y,xsize,ysize,xchars,ychars,fill,flags; public ushort show,reserved2; public IntPtr reservedPtr,input,output,error; }
 [StructLayout(LayoutKind.Sequential)] struct PROCESS { public IntPtr process,thread; public uint pid,tid; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attrs,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int info,ref EXTENDED limits,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUP startup,out PROCESS info);
 [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 static void Check(bool ok) { if(!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
 static string Quote(string value) {
  var b=new StringBuilder("\""); int slashes=0;
  foreach(char c in value) { if(c=='\\') { slashes++; continue; } if(c=='\"') { b.Append('\\',slashes*2+1); b.Append(c); } else { b.Append('\\',slashes);b.Append(c); } slashes=0; }
  b.Append('\\',slashes*2);b.Append('"');return b.ToString();
 }
 public static int Run(string executable,string[] args,string cwd) {
  IntPtr job=CreateJobObject(IntPtr.Zero,null);Check(job!=IntPtr.Zero); PROCESS child=new PROCESS();bool started=false;
  try {
   var limits=new EXTENDED();limits.BasicLimitInformation.LimitFlags=0x2000; // KILL_ON_JOB_CLOSE; no breakaway.
   Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED))));
   var startup=new STARTUP();startup.cb=(uint)Marshal.SizeOf(typeof(STARTUP));startup.flags=0x100;startup.input=GetStdHandle(-10);startup.output=GetStdHandle(-11);startup.error=GetStdHandle(-12);
   var cmd=new StringBuilder(Quote(executable));foreach(string a in args)cmd.Append(" "+Quote(a));
   Check(CreateProcess(executable,cmd,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,cwd,ref startup,out child));started=true;
   Check(AssignProcessToJobObject(job,child.process));if(ResumeThread(child.thread)==0xffffffff)Check(false);
   if(WaitForSingleObject(child.process,0xffffffff)!=0)Check(false);
   uint code;Check(GetExitCodeProcess(child.process,out code));
   // Closing original parent must never orphan detached descendants or their pipe handles.
   Check(TerminateJobObject(job,code));return unchecked((int)code);
  } finally { if(started) { TerminateProcess(child.process,1);CloseHandle(child.thread);CloseHandle(child.process); } CloseHandle(job); }
 }
}
'@
$decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Request)) | ConvertFrom-Json
if (!$decoded.executable -or !$decoded.cwd) { throw 'Invalid owned process request' }
$env:BUN_BE_BUN = $env:OMP_SYSTEM_CHILD_BUN
Remove-Item Env:OMP_SYSTEM_CHILD_BUN -ErrorAction SilentlyContinue
exit [OmpOwnedJob]::Run([string]$decoded.executable,[string[]]$decoded.args,[string]$decoded.cwd)
