import childProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { HostAuthorityError } from './remote.ts'

// Fixed code only: profile paths and later worktree requests travel through bounded stdin JSON.
const PROGRAM = String.raw`
$ErrorActionPreference='Stop'
$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')
$utf8=[Text.UTF8Encoding]::new($false)
[Console]::InputEncoding=$utf8; [Console]::OutputEncoding=$utf8
$handles=New-Object 'Collections.Generic.List[IntPtr]'
$opened=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$script:phase='binding'
$script:win32=-1
$script:fileSd=[IntPtr]::Zero; $script:directorySd=[IntPtr]::Zero
$script:fileSa=[IntPtr]::Zero; $script:directorySa=[IntPtr]::Zero
try {
  if($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage'){throw 'language'}
  # SECURITY_ATTRIBUTES and pointer-bearing descriptors below are only correct for the x64 Win32 ABI.
  # ARM64 also has 8-byte pointers, so pointer width alone is not an architecture gate.
  if([IntPtr]::Size -ne 8 -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64'){throw 'platform'}
  $assembly=[AppDomain]::CurrentDomain.DefineDynamicAssembly((New-Object Reflection.AssemblyName('PrivateRoot')), [Reflection.Emit.AssemblyBuilderAccess]::Run)
  $builder=$assembly.DefineDynamicModule('Native').DefineType('Native','Public, Abstract, Sealed')
  function Bind($name,$dll,$return,$parameters) {
    # DefinePInvokeMethod already creates ImplMap; a later pseudo attribute cannot update its flags.
    $method=$builder.DefineMethod($name,'Public, Static, PinvokeImpl','Standard',$return,$parameters)
    $attribute=[Runtime.InteropServices.DllImportAttribute]
    $fields=[Reflection.FieldInfo[]]@($attribute.GetField('SetLastError'),$attribute.GetField('CharSet'),$attribute.GetField('CallingConvention'),$attribute.GetField('EntryPoint'))
    $values=[object[]]@($true,[Runtime.InteropServices.CharSet]::Unicode,[Runtime.InteropServices.CallingConvention]::Winapi,$name)
    $method.SetCustomAttribute((New-Object Reflection.Emit.CustomAttributeBuilder($attribute.GetConstructor([type[]]@([string])),[object[]]@($dll),$fields,$values)))
    $method.SetImplementationFlags('PreserveSig')
    if($name -ceq 'CreateFileW'){$script:createFile=$method}
    if($name -ceq 'CreateDirectoryW'){$script:createDirectory=$method}
  }
  $ptr=[IntPtr]; $ref=$ptr.MakeByRefType(); $u=[uint32]; $s=[string]; $sb=[Text.StringBuilder]
  Bind CreateFileW kernel32.dll $ptr ([type[]]@($s,$u,$u,$ptr,$u,$u,$ptr))
  Bind CreateDirectoryW kernel32.dll ([int]) ([type[]]@($s,$ptr))
  Bind ConvertStringSecurityDescriptorToSecurityDescriptorW advapi32.dll ([int]) ([type[]]@($s,$u,$ref,$ptr))
  Bind GetFileType kernel32.dll $u ([type[]]@($ptr))
  Bind GetFileInformationByHandle kernel32.dll ([int]) ([type[]]@($ptr,$ptr))
  Bind GetVolumeInformationByHandleW kernel32.dll ([int]) ([type[]]@($ptr,$sb,$u,$ptr,$ptr,$ptr,$sb,$u))
  Bind GetFinalPathNameByHandleW kernel32.dll $u ([type[]]@($ptr,$sb,$u,$u))
  Bind GetSecurityInfo advapi32.dll $u ([type[]]@($ptr,$u,$u,$ref,$ref,$ref,$ref,$ref))
  Bind GetSecurityDescriptorLength advapi32.dll $u ([type[]]@($ptr))
  Bind LocalFree kernel32.dll $ptr ([type[]]@($ptr))
  Bind CloseHandle kernel32.dll ([int]) ([type[]]@($ptr))
  # No PowerShell reflection/binding may intervene between the P/Invoke and cached error capture.
  # OpenChecked(path, access, out win32Error): ldc.i4.3 = OPEN_EXISTING, 0x02200000 = BACKUP_SEMANTICS|OPEN_REPARSE_POINT,
  # share mode 3 = READ|WRITE (no DELETE); GetLastWin32Error is captured in IL before any managed call can clobber it.
  $wrapper=$builder.DefineMethod('OpenChecked','Public, Static',$ptr,[type[]]@($s,$u,[int].MakeByRefType()))
  $il=$wrapper.GetILGenerator(); $saved=$il.DeclareLocal($ptr); $op=[Reflection.Emit.OpCodes]
  $il.Emit($op::Ldarg_0); $il.Emit($op::Ldarg_1); $il.Emit($op::Ldc_I4_3)
  $il.Emit($op::Ldsfld,[IntPtr].GetField('Zero')); $il.Emit($op::Ldc_I4_3)
  $il.Emit($op::Ldc_I4,35651584); $il.Emit($op::Ldsfld,[IntPtr].GetField('Zero'))
  $il.Emit($op::Call,$script:createFile); $il.Emit($op::Stloc,$saved)
  $il.Emit($op::Ldarg_2); $il.Emit($op::Call,[Runtime.InteropServices.Marshal].GetMethod('GetLastWin32Error'))
  $il.Emit($op::Stind_I4); $il.Emit($op::Ldloc,$saved); $il.Emit($op::Ret)
  # ProbeChecked(path, out win32Error): access 0, share 3, OPEN_EXISTING + BACKUP_SEMANTICS|OPEN_REPARSE_POINT.
  # CreateDirectoryW has no reparse-point flag, so the final component is probed here before any create call;
  # a dangling junction/symlink opens as a reparse point and the existing Open then refuses it.
  $wrapper=$builder.DefineMethod('ProbeChecked','Public, Static',$ptr,[type[]]@($s,[int].MakeByRefType()))
  $il=$wrapper.GetILGenerator(); $saved=$il.DeclareLocal($ptr)
  $il.Emit($op::Ldarg_0); $il.Emit($op::Ldc_I4_0); $il.Emit($op::Ldc_I4_3)
  $il.Emit($op::Ldsfld,[IntPtr].GetField('Zero')); $il.Emit($op::Ldc_I4_3)
  $il.Emit($op::Ldc_I4,35651584); $il.Emit($op::Ldsfld,[IntPtr].GetField('Zero'))
  $il.Emit($op::Call,$script:createFile); $il.Emit($op::Stloc,$saved)
  $il.Emit($op::Ldarg_1); $il.Emit($op::Call,[Runtime.InteropServices.Marshal].GetMethod('GetLastWin32Error'))
  $il.Emit($op::Stind_I4); $il.Emit($op::Ldloc,$saved); $il.Emit($op::Ret)
  # CreateChecked(path, sa, out win32Error): attribute-only desiredAccess=0, share 3 = READ|WRITE,
  # CREATE_NEW=1, flags = FILE_ATTRIBUTE_NORMAL(0x80) | FILE_FLAG_OPEN_REPARSE_POINT(0x00200000).
  # The reparse flag makes a pre-existing (including dangling) link fail with ERROR_FILE_EXISTS instead of
  # following it and creating the target; the error is captured in IL before any managed call can clobber it.
  $wrapper=$builder.DefineMethod('CreateChecked','Public, Static',$ptr,[type[]]@($s,$ptr,[int].MakeByRefType()))
  $il=$wrapper.GetILGenerator(); $saved=$il.DeclareLocal($ptr)
  $il.Emit($op::Ldarg_0); $il.Emit($op::Ldc_I4_0)
  $il.Emit($op::Ldc_I4_3); $il.Emit($op::Ldarg_1)
  $il.Emit($op::Ldc_I4_1); $il.Emit($op::Ldc_I4,2097280); $il.Emit($op::Ldsfld,[IntPtr].GetField('Zero'))
  $il.Emit($op::Call,$script:createFile); $il.Emit($op::Stloc,$saved)
  $il.Emit($op::Ldarg_2); $il.Emit($op::Call,[Runtime.InteropServices.Marshal].GetMethod('GetLastWin32Error'))
  $il.Emit($op::Stind_I4); $il.Emit($op::Ldloc,$saved); $il.Emit($op::Ret)
  # CreateDirectoryChecked(path, sa, out win32Error): BOOL result with the same atomic error capture.
  $wrapper=$builder.DefineMethod('CreateDirectoryChecked','Public, Static',[int],[type[]]@($s,$ptr,[int].MakeByRefType()))
  $il=$wrapper.GetILGenerator(); $created=$il.DeclareLocal([int])
  $il.Emit($op::Ldarg_0); $il.Emit($op::Ldarg_1); $il.Emit($op::Call,$script:createDirectory); $il.Emit($op::Stloc,$created)
  $il.Emit($op::Ldarg_2); $il.Emit($op::Call,[Runtime.InteropServices.Marshal].GetMethod('GetLastWin32Error'))
  $il.Emit($op::Stind_I4); $il.Emit($op::Ldloc,$created); $il.Emit($op::Ret)
  $N=$builder.CreateType(); $M=[Runtime.InteropServices.Marshal]
  $imports=@($N.GetMethod('CreateFileW').GetCustomAttributes([Runtime.InteropServices.DllImportAttribute],$false))
  if($imports.Count -ne 1){throw 'metadata'}
  $import=$imports[0]
  if(!$import.SetLastError -or !$import.PreserveSig -or $import.CharSet -ne 'Unicode' -or
    $import.CallingConvention -ne 'Winapi' -or $import.EntryPoint -cne 'CreateFileW' -or $import.Value -cne 'kernel32.dll'){throw 'metadata'}
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $trusted=@($sid,'S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
  # 创建调用内带目标 SD：显式 owner=token 用户、D:P、目录 OI/CI full，文件去掉继承位；与 #643 的 canonical 形状一致。
  function New-Descriptor([string]$sddl) {
    $descriptor=[IntPtr]::Zero
    if(!$N::ConvertStringSecurityDescriptorToSecurityDescriptorW($sddl,1,[ref]$descriptor,[IntPtr]::Zero) -or $descriptor -eq [IntPtr]::Zero){throw 'security'}
    return $descriptor
  }
  function New-Attributes([IntPtr]$descriptor) {
    $attributes=$M::AllocHGlobal(24)
    if($attributes -eq [IntPtr]::Zero){throw 'security'}
    $M::WriteInt32($attributes,0,24); $M::WriteIntPtr($attributes,8,$descriptor); $M::WriteInt32($attributes,16,0)
    return $attributes
  }
  $script:fileSd=New-Descriptor ('O:'+$sid+'D:P(A;;FA;;;'+$sid+')(A;;FA;;;SY)(A;;FA;;;BA)')
  $script:directorySd=New-Descriptor ('O:'+$sid+'D:P(A;OICI;FA;;;'+$sid+')(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)')
  $script:fileSa=New-Attributes $script:fileSd
  $script:directorySa=New-Attributes $script:directorySd
  function ReadInput {
    $line=[Console]::ReadLine()
    if($null -eq $line -or $line.Length -gt 32768){throw 'input'}
    return ($line|ConvertFrom-Json)
  }
  function Lexical([string]$p) {
    if($p.Length -gt 8192 -or $p -notmatch '^[A-Za-z]:\\' -or $p.Substring(2) -match '[\x00-\x1f/:*?"<>|~]'){throw 'path'}
    foreach($part in $p.Substring(3).Split('\')) {
      if(!$part -or $part -match '[. ]$' -or $part -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)'){throw 'alias'}
    }
  }
  function Rights([int]$raw) {
    $mask=[int64]$raw -band 4294967295L; $result=$mask -band 268435455L
    if($mask -band 2147483648L){$result=$result -bor 1179785}
    if($mask -band 1073741824L){$result=$result -bor 1179926}
    if($mask -band 536870912L){$result=$result -bor 1179808}
    if($mask -band 268435456L){$result=$result -bor 2032127}
    return $result
  }
  function Security($handle,[bool]$private,[bool]$inherit,[bool]$volumeRoot) {
    $owner=$group=$dacl=$sacl=$descriptor=[IntPtr]::Zero
    if($N::GetSecurityInfo($handle,1,5,[ref]$owner,[ref]$group,[ref]$dacl,[ref]$sacl,[ref]$descriptor) -ne 0){throw 'security'}
    try {
      $size=$N::GetSecurityDescriptorLength($descriptor)
      if($size -lt 20 -or $size -gt 65536){throw 'descriptor'}
      $bytes=New-Object byte[] $size; $M::Copy($descriptor,$bytes,0,$size)
      $raw=New-Object Security.AccessControl.RawSecurityDescriptor($bytes,0)
      if(!$raw.Owner -or ($private -and $raw.Owner.Value -ne $sid) -or (!$private -and $raw.Owner.Value -notin $trusted)){throw 'owner'}
      if(!$raw.DiscretionaryAcl -or !($raw.ControlFlags -band 4) -or $raw.DiscretionaryAcl.Count -gt 128){throw 'dacl'}
      $fileInheritance=$false
      foreach($ace in $raw.DiscretionaryAcl) {
        if($ace -isnot [Security.AccessControl.CommonAce] -or $ace.IsCallback -or $ace.AceQualifier -notin @('AccessAllowed','AccessDenied')){throw 'ace'}
        if($ace.AceQualifier -eq 'AccessDenied'){continue}
        $rights=Rights $ace.AccessMask; $flags=[int]$ace.AceFlags
        if($ace.SecurityIdentifier.Value -notin $trusted) {
          if($private){throw 'grant'}
          $dangerous=852306
          if(!$volumeRoot){$dangerous=$dangerous -bor 4}
          if(!($flags -band 8) -and ($rights -band $dangerous)){throw 'ancestor'}
        }
        if($ace.SecurityIdentifier.Value -eq $sid -and ($flags -band 1) -and !($flags -band 4) -and (($rights -band 2032127) -eq 2032127)){$fileInheritance=$true}
      }
      if($inherit -and (!($raw.ControlFlags -band 4096) -or !$fileInheritance)){throw 'inheritance'}
    } finally { if($descriptor -ne [IntPtr]::Zero){$null=$N::LocalFree($descriptor)} }
  }
  function Open([string]$p,[bool]$directory,[bool]$private,[bool]$inherit,[bool]$optional,[bool]$volumeRoot,[string]$phaseName) {
    $script:phase=$phaseName
    if($directory -and $opened.Contains($p)){return}
    if($directory -and $handles.Count -ge 64){throw 'handles'}
    # Attribute-only opens bypass I/O sharing checks; directory LIST makes deny-delete effective.
    $access=if($directory){131201}else{131200}
    $errorCode=0; $h=$N::OpenChecked($p,$access,[ref]$errorCode)
    if($h -eq [IntPtr]::new(-1)){
      $script:win32=$errorCode
      if($optional -and $errorCode -eq 2){return}
      $reason=switch($errorCode){2{'notfound'}3{'path'}5{'access'}32{'sharing'}default{'other'}}
      throw ('open-'+$reason)
    }
    try {
      if($N::GetFileType($h) -ne 1){throw 'disk'}
      $info=$M::AllocHGlobal(52)
      try {
        if(!$N::GetFileInformationByHandle($h,$info)){throw 'identity'}
        $attrs=$M::ReadInt32($info,0)
        if(($attrs -band 1024) -or [bool]($attrs -band 16) -ne $directory){throw 'type'}
        if(!$directory -and $M::ReadInt32($info,40) -ne 1){throw 'links'}
        if(($M::ReadInt32($info,44) -eq 0) -and ($M::ReadInt32($info,48) -eq 0)){throw 'identity'}
      } finally {$M::FreeHGlobal($info)}
      $fs=New-Object Text.StringBuilder(32)
      if(!$N::GetVolumeInformationByHandleW($h,$null,0,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero,$fs,32) -or $fs.ToString() -cne 'NTFS'){throw 'filesystem'}
      if($volumeRoot){
        $final=New-Object Text.StringBuilder(128); $length=$N::GetFinalPathNameByHandleW($h,$final,128,1)
        if(!$length -or $length -ge 128 -or $final.ToString() -notmatch '^\\\\\?\\Volume\{[0-9a-f-]{36}\}\\$'){throw 'volume'}
      }
      Security $h $private $inherit $volumeRoot
      if($directory){$handles.Add($h); $null=$opened.Add($p); $h=[IntPtr]::Zero}
    } finally {if($h -ne [IntPtr]::Zero){$null=$N::CloseHandle($h)}}
  }
  # Create-or-admit (adopt-only): 最终分量先探测。悬空 reparse 只能被既有 Open 拒绝，绝不能被创建调用跟随；
  # EXISTS(183 目录 / 80 文件) 表示探测后的并发或重开，同样交给 Open 复核。其它创建错误有界拒绝。
  function Ensure([string]$p,[bool]$directory,[string]$phaseName) {
    $script:phase=$phaseName
    $probeError=0; $existing=$N::ProbeChecked($p,[ref]$probeError)
    if($existing -ne [IntPtr]::new(-1)){
      $null=$N::CloseHandle($existing)
      Open $p $directory $true ([bool]$directory) $false $false $phaseName
      return
    }
    if($probeError -ne 2){
      $script:win32=$probeError
      $reason=switch($probeError){3{'path'}5{'access'}32{'sharing'}default{'other'}}
      throw ('create-'+$reason)
    }
    $errorCode=0; $created=0
    if($directory){
      $created=$N::CreateDirectoryChecked($p,$script:directorySa,[ref]$errorCode)
      if($created -ne 0){$errorCode=0}
    } else {
      $created=$N::CreateChecked($p,$script:fileSa,[ref]$errorCode)
      if($created -ne [IntPtr]::new(-1)){$null=$N::CloseHandle($created); $errorCode=0}
    }
    if($errorCode -ne 0 -and $errorCode -ne 183 -and $errorCode -ne 80){
      $script:win32=$errorCode
      $reason=switch($errorCode){2{'notfound'}3{'path'}5{'access'}32{'sharing'}default{'other'}}
      throw ('create-'+$reason)
    }
    Open $p $directory $true ([bool]$directory) $false $false $phaseName
  }
  $request=ReadInput
  if(@($request.PSObject.Properties.Name).Count -ne 1 -or $request.profile -isnot [string]){throw 'schema'}
  $profilePath=$request.profile; Lexical $profilePath
  $drive=$profilePath.Substring(0,3)
  if((New-Object IO.DriveInfo($drive)).DriveType -ne 'Fixed'){throw 'drive'}
  $location=$drive; Open $location $true $false $false $false $true 'volume'
  $parts=$profilePath.Substring(3).Split('\')
  for($i=0;$i -lt $parts.Count;$i++) {
    $location=[IO.Path]::Combine($location,$parts[$i])
    Open $location $true ($i -eq $parts.Count-1) $false $false $false $(if($i -eq $parts.Count-1){'profile'}else{'ancestor'})
  }
  $root=[IO.Path]::Combine($profilePath,'harness-projects'); Ensure $root $true 'plugin'
  $database=[IO.Path]::Combine($root,'workspace.sqlite')
  Ensure $database $false 'database'
  Ensure ([IO.Path]::Combine($root,'diagnostics.log')) $false 'log'
  foreach($suffix in @('-wal','-shm','-journal')){Open ($database+$suffix) $false $true $false $true $false 'sidecar'}
  [Console]::WriteLine('private-windows-v1')
  while($null -ne ($line=[Console]::ReadLine())) {
    if($line -ceq 'close'){break}
    if($line.Length -gt 32768){throw 'input'}
    $request=$line|ConvertFrom-Json
    if(@($request.PSObject.Properties.Name).Count -ne 1 -or $request.directories.Count -ne 2){throw 'schema'}
    $worktrees=[IO.Path]::Combine($root,'worktrees')
    if($request.directories[0] -cne $worktrees -or [IO.Path]::GetDirectoryName($request.directories[1]) -cne $worktrees){throw 'worktrees'}
    foreach($directory in $request.directories){Lexical $directory; Ensure $directory $true 'worktrees'}
    [Console]::WriteLine('private-windows-added-v1')
  }
} catch {
  $code=$_.Exception.Message
  if($code -notin @('language','platform','metadata','input','path','alias','security','descriptor','owner','dacl','ace','grant','ancestor',
    'inheritance','handles','open-notfound','open-path','open-access','open-sharing','open-other',
    'create-notfound','create-path','create-access','create-sharing','create-other',
    'disk','identity','type','links','filesystem','volume','schema','drive','worktrees')){$code='native'}
  if(($code.StartsWith('open-') -or $code.StartsWith('create-')) -and $script:win32 -ge 0 -and $script:win32 -le 65535){$code+='-'+$script:win32}
  [Console]::WriteLine('private-windows-error-'+$script:phase+'-'+$code); exit 1
}
finally {
  foreach($handle in $handles){$null=$N::CloseHandle($handle)}
  foreach($descriptor in @($script:fileSd,$script:directorySd)){if($descriptor -ne [IntPtr]::Zero){$null=$N::LocalFree($descriptor)}}
  foreach($attributes in @($script:fileSa,$script:directorySa)){if($attributes -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::FreeHGlobal($attributes)}}
}
`

const unavailable = () => new HostAuthorityError('Host project data is unavailable')

/** Native metadata probes finish before Node/SQLite reopen; directory handles remain in the helper. */
export async function prepareWindowsProjectData(profile: string, signal?: AbortSignal) {
  const startupDeadline = performance.now() + 15000
  const system = process.env.SystemRoot
  if (signal?.aborted || process.platform !== 'win32' || !system || !/^[A-Za-z]:\\[^\x00-\x1f:*?"<>|]+$/.test(system)
    || PROGRAM.length + 128 >= 24000 || Buffer.byteLength(JSON.stringify({ profile })) > 65536) throw unavailable()
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'))
  env.PSModulePath = path.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules')
  const child = childProcess.spawn(path.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', PROGRAM], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env })
  const invalidated = new AbortController()
  let bytes = 0, output = '', ready = false, quiescing = false, stopping = false, failed = false, disposal: Promise<void> | undefined
  let accept: (() => void) | undefined, refuse: ((error: Error) => void) | undefined
  let expected = ''
  const closed = new Promise<void>((resolve) => child.once('close', () => {
    signal?.removeEventListener('abort', abort)
    if (!stopping) fail()
    resolve()
  }))
  const fail = () => {
    if (failed || stopping) return
    failed = true; refuse?.(unavailable())
    if (ready) invalidated.abort(unavailable())
    else child.kill()
  }
  const abort = () => {
    if (ready) { quiescing = true; refuse?.(unavailable()) } // Normal owner stop retains directories until final release.
    else fail()
  }
  signal?.addEventListener('abort', abort, { once: true })
  child.once('error', fail)
  child.stdin.on('error', fail)
  child.stderr.on('data', fail)
  child.stdout.on('data', (chunk: Buffer) => {
    if (stopping || quiescing || failed) return
    bytes += chunk.length
    if (!accept || bytes > 4096) { fail(); return }
    output += chunk.toString('utf8')
    if (!expected.startsWith(output)) { fail(); return }
    if (output === expected) { output = ''; accept() }
  })
  const request = (value: unknown, token: string, requestSignal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    const line = JSON.stringify(value) + '\n'
    if (failed || stopping || quiescing || accept || requestSignal?.aborted || Buffer.byteLength(line) > 65536) { reject(unavailable()); return }
    const cancel = () => signal?.aborted ? abort() : fail()
    const timer = setTimeout(fail, ready ? 15000 : Math.max(0, startupDeadline - performance.now()))
    const finish = (error?: Error) => {
      clearTimeout(timer); requestSignal?.removeEventListener('abort', cancel)
      accept = undefined; refuse = undefined
      if (error) reject(error); else resolve()
    }
    bytes = 0; output = ''; expected = token + '\r\n'; accept = () => finish(); refuse = (error) => finish(error)
    requestSignal?.addEventListener('abort', cancel, { once: true })
    child.stdin.write(line)
  })
  const dispose = (deadline = Date.now() + 1000): Promise<void> => disposal ??= (async () => {
    stopping = true; refuse?.(unavailable()); child.stdin.end('close\n')
    const timer = setTimeout(() => child.kill(), Math.max(0, deadline - Date.now()))
    try { await closed } finally { clearTimeout(timer) }
  })()
  try {
    await request({ profile }, 'private-windows-v1', signal)
    if (signal?.aborted || failed) throw unavailable()
    ready = true
    const directory = path.join(profile, 'harness-projects')
    const logFd = fs.openSync(path.join(directory, 'diagnostics.log'), fs.constants.O_WRONLY | fs.constants.O_APPEND)
    return { directory, logFd, signal: invalidated.signal, dispose,
      assertDirectories: (directories: readonly string[], requestSignal?: AbortSignal) => request({ directories }, 'private-windows-added-v1', requestSignal) }
  } catch { await dispose(); throw unavailable() }
}
