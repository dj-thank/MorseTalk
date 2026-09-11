# Windows-only syntax and loopback startup check. Does not test a microphone or ASR.
$ErrorActionPreference='Stop'
$Root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
foreach($file in Get-ChildItem $PSScriptRoot -Filter *.ps1){
  $tokens=$null;$errors=$null
  [void][Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)
  if($errors.Count -gt 0){throw ($errors|Out-String)}
}
$exe=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$proc=Start-Process -FilePath $exe -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $PSScriptRoot 'server.ps1')+'"'),'-Port','18765','-NoBrowser') -PassThru
try{
  $response=$null
  for($i=0;$i -lt 40;$i++){
    if($proc.HasExited){throw 'Server exited before startup.'}
    try{$response=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:18765/' -TimeoutSec 2;break}catch{Start-Sleep -Milliseconds 250}
  }
  if(-not $response -or $response.StatusCode -ne 200){throw 'Loopback server did not start.'}
  if($response.Content -notmatch 'name="morsetalk-token" content="([a-z0-9]+)"'){throw 'Missing local token.'}
  $token=$Matches[1]
  $cap=Invoke-RestMethod -Uri 'http://127.0.0.1:18765/api/capabilities' -Headers @{'X-MorseTalk-Token'=$token} -TimeoutSec 5
  if($null -eq $cap.offlineSpeech){throw 'Invalid capabilities response.'}
  Write-Host 'PASS: PowerShell syntax, loopback startup, token injection and capabilities.'
}finally{if(-not $proc.HasExited){Stop-Process -Id $proc.Id -Force};$proc.Dispose()}
