# A loopback TCP server avoids HttpListener URL ACL / administrator requirements.
# Windows PowerShell 5.1. No installation, policy change, firewall rule or cloud API.
param([ValidateRange(1024,65535)][int]$Port=8765,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
$Root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$App=[IO.Path]::GetFullPath((Join-Path $Root 'app'))
$origin="http://127.0.0.1:$Port"
$random=New-Object byte[] 32
$rng=[Security.Cryptography.RandomNumberGenerator]::Create();$rng.GetBytes($random);$rng.Dispose()
$token=([BitConverter]::ToString($random)).Replace('-','').ToLowerInvariant()
$capsText=& (Join-Path $PSScriptRoot 'speech-capabilities.ps1')
$listener=New-Object System.Net.Sockets.TcpListener -ArgumentList ([Net.IPAddress]::Loopback),$Port
$pool=[RunspaceFactory]::CreateRunspacePool(1,4);$pool.Open()
$jobs=New-Object System.Collections.ArrayList
$speechLock=New-Object System.Threading.SemaphoreSlim -ArgumentList 1,1
$worker={
  param($Client,$Root,$App,$Origin,$Token,$CapsText,$SpeechLock)
  $ErrorActionPreference='Stop'
  $stream=$null;$held=$false;$temp=$null
  function Send-Reply([int]$Code,[byte[]]$Body,[string]$Type='application/json; charset=utf-8'){
    $csp="default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    $reason=switch($Code){200{'OK'}400{'Bad Request'}403{'Forbidden'}404{'Not Found'}405{'Method Not Allowed'}409{'Conflict'}411{'Length Required'}413{'Payload Too Large'}415{'Unsupported Media Type'}default{'Service Unavailable'}}
    $h="HTTP/1.1 $Code $reason`r`nContent-Type: $Type`r`nContent-Length: $($Body.Length)`r`nConnection: close`r`nCache-Control: no-store`r`nContent-Security-Policy: $csp`r`nX-Content-Type-Options: nosniff`r`nCross-Origin-Resource-Policy: same-origin`r`nReferrer-Policy: no-referrer`r`nPermissions-Policy: microphone=(self), camera=(), geolocation=()`r`n`r`n"
    $header=[Text.Encoding]::ASCII.GetBytes($h);$stream.Write($header,0,$header.Length)
    $stream.Write($Body,0,$Body.Length);$stream.Flush()
  }
  function Send-Json([int]$Code,$Object){$b=[Text.Encoding]::UTF8.GetBytes(($Object|ConvertTo-Json -Compress -Depth 8));Send-Reply $Code $b}
  try {
    $Client.ReceiveTimeout=10000;$Client.SendTimeout=10000;$stream=$Client.GetStream()
    $header=New-Object System.IO.MemoryStream
    $tail='';$complete=$false
    while($header.Length -lt 16384){
      $b=$stream.ReadByte();if($b -lt 0){throw 'Unexpected EOF'}
      $header.WriteByte([byte]$b);$tail+=([char]$b);if($tail.Length -gt 4){$tail=$tail.Substring($tail.Length-4)}
      if($tail -eq "`r`n`r`n"){$complete=$true;break}
    }
    if(-not $complete){Send-Json 400 @{error='Header too large'};return}
    $lines=([Text.Encoding]::ASCII.GetString($header.ToArray())).Split(@("`r`n"),[StringSplitOptions]::None);$header.Dispose()
    if($lines[0] -notmatch '^(GET|POST) (/[^ ]{0,2047}) HTTP/1\.[01]$'){Send-Json 405 @{error='Method or request target not allowed'};return}
    $method=$Matches[1];$target=$Matches[2];$headers=@{}
    foreach($line in $lines[1..($lines.Length-1)]){
      if($line -eq ''){continue};$p=$line.IndexOf(':')
      if($p -lt 1){Send-Json 400 @{error='Malformed header'};return}
      $name=$line.Substring(0,$p).Trim();$value=$line.Substring($p+1).Trim()
      if($headers.ContainsKey($name)){Send-Json 400 @{error='Duplicate header'};return};$headers[$name]=$value
    }
    if($headers['Host'] -cne ([Uri]$Origin).Authority -or $headers['Sec-Fetch-Site'] -eq 'cross-site'){Send-Json 403 @{error='Host or site not allowed'};return}
    $rawPath=$target.Split('?')[0];$path=[Uri]::UnescapeDataString($rawPath)
    if($path.Contains('\') -or $path.Contains([string][char]0) -or @($path.Split('/') | Where-Object {$_ -eq '..'}).Count -gt 0){Send-Json 400 @{error='Invalid path'};return}
    if($path.StartsWith('/api/')){
      if($headers['X-MorseTalk-Token'] -cne $Token){Send-Json 403 @{error='ローカルトークンが不一致です。画面を再読み込みしてください。'};return}
      if($path -eq '/api/capabilities' -and $method -eq 'GET'){Send-Reply 200 ([Text.Encoding]::UTF8.GetBytes(($CapsText -join "`n")));return}
      if($path -ne '/api/transcribe' -or $method -ne 'POST'){Send-Json 404 @{error='Not found'};return}
      if($headers['Origin'] -cne $Origin){Send-Json 403 @{error='Origin not allowed'};return}
      if($headers.ContainsKey('Transfer-Encoding') -or -not $headers.ContainsKey('Content-Length')){Send-Json 411 @{error='Content-Length required'};return}
      [int]$length=0
      if(-not [int]::TryParse($headers['Content-Length'],[ref]$length) -or $length -gt 700000 -or $length -lt 44){Send-Json 413 @{error='録音は最大20秒です。'};return}
      if($headers['Content-Type'] -ne 'audio/wav'){Send-Json 415 @{error='audio/wav required'};return}
      $language='ja-JP'
      if($target.Contains('?')){
        $q=$target.Substring($target.IndexOf('?')+1)
        if($q -notmatch '^language=(ja-JP|en-US)$'){Send-Json 400 @{error='Unsupported language'};return};$language=$Matches[1]
      }
      $body=New-Object byte[] $length;$read=0
      while($read -lt $length){$n=$stream.Read($body,$read,$length-$read);if($n -eq 0){throw 'Unexpected EOF'};$read+=$n}
      # Recorder produces canonical PCM16 WAV. Reject arbitrary uploaded formats.
      $tag=[Text.Encoding]::ASCII.GetString($body)
      if($tag.Substring(0,4) -ne 'RIFF' -or [BitConverter]::ToUInt32($body,4) -ne ($length-8) -or [BitConverter]::ToUInt32($body,16) -ne 16 -or [BitConverter]::ToUInt32($body,28) -ne 32000 -or [BitConverter]::ToUInt16($body,32) -ne 2 -or (($length-44) % 2) -ne 0 -or $tag.Substring(8,4) -ne 'WAVE' -or $tag.Substring(12,4) -ne 'fmt ' -or $tag.Substring(36,4) -ne 'data' -or [BitConverter]::ToUInt16($body,20) -ne 1 -or [BitConverter]::ToUInt16($body,22) -ne 1 -or [BitConverter]::ToUInt32($body,24) -ne 16000 -or [BitConverter]::ToUInt16($body,34) -ne 16 -or [BitConverter]::ToUInt32($body,40) -ne ($length-44) -or ($length-44) -lt 4800 -or ($length-44) -gt 672000){Send-Json 400 @{error='16 kHz mono PCM16 WAV required, 0.15 to 20 seconds'};return}
      $held=$SpeechLock.Wait(0);if(-not $held){Send-Json 409 @{error='別の音声を認識中です。'};return}
      $temp=Join-Path ([IO.Path]::GetTempPath()) ('morsetalk-'+[Guid]::NewGuid().ToString('N')+'.wav')
      [IO.File]::WriteAllBytes($temp,$body)
      $scriptPath=Join-Path $Root 'windows\recognize.ps1'
      # Separate native process provides an upper bound even for a stalled SAPI engine.
      $psi=New-Object Diagnostics.ProcessStartInfo
      $psi.FileName='powershell.exe'
      $psi.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$scriptPath+'" -WavePath "'+$temp+'" -Language '+$language
      $psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true
      $psi.StandardOutputEncoding=New-Object Text.UTF8Encoding($false)
      $proc=New-Object Diagnostics.Process;$proc.StartInfo=$psi;[void]$proc.Start()
      $outTask=$proc.StandardOutput.ReadToEndAsync();$errTask=$proc.StandardError.ReadToEndAsync()
      if(-not $proc.WaitForExit(45000)){try{$proc.Kill()}catch{};$proc.Dispose();Send-Json 503 @{error='音声認識がタイムアウトしました。'};return}
      $output=$outTask.Result;$exitCode=$proc.ExitCode;$proc.Dispose()
      try{$parsed=$output|ConvertFrom-Json}catch{throw 'Windowsの音声認識応答を読めませんでした。'}
      if($exitCode -ne 0 -or $parsed.error){Send-Json 503 @{error=$parsed.error};return}
      Send-Json 200 @{text=$parsed.text;offline=$true};return
    }
    if($method -ne 'GET'){Send-Json 405 @{error='Method not allowed'};return}
    $relative=if($path -eq '/'){'index.html'}else{$path.TrimStart('/')}
    $file=[IO.Path]::GetFullPath((Join-Path $App $relative))
    if(-not $file.StartsWith($App+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or -not [IO.File]::Exists($file)){Send-Json 404 @{error='Not found'};return}
    $extension=[IO.Path]::GetExtension($file).ToLowerInvariant()
    $types=@{'.html'='text/html; charset=utf-8';'.css'='text/css; charset=utf-8';'.mjs'='text/javascript; charset=utf-8';'.js'='text/javascript; charset=utf-8';'.svg'='image/svg+xml';'.webmanifest'='application/manifest+json'}
    if(-not $types.ContainsKey($extension)){Send-Json 404 @{error='Not found'};return}
    if([IO.Path]::GetFileName($file) -eq 'index.html'){$data=[Text.Encoding]::UTF8.GetBytes(([IO.File]::ReadAllText($file)).Replace('__MORSETALK_TOKEN__',$Token))}else{$data=[IO.File]::ReadAllBytes($file)}
    Send-Reply 200 $data $types[$extension]
  }catch{try{if($null -ne $stream){Send-Json 503 @{error=$_.Exception.Message}}}catch{}}
  finally{if($held){[void]$SpeechLock.Release()};if($temp){Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue};if($stream){$stream.Dispose()};$Client.Close()}
}
try{
  $listener.Start()
  Write-Host "MorseTalk: $origin/"
  Write-Host 'このPC内だけで動きます。終了するには、このウィンドウでCtrl+C。'
  if(-not $NoBrowser){Start-Process "$origin/"}
  while($true){
    foreach($job in @($jobs.ToArray())){if($job.Handle.IsCompleted){try{[void]$job.PowerShell.EndInvoke($job.Handle)}catch{};$job.PowerShell.Dispose();[void]$jobs.Remove($job)}}
    if($listener.Pending()){
      $client=$listener.AcceptTcpClient()
      if($jobs.Count -ge 12){$client.Close();continue}
      $ps=[PowerShell]::Create();$ps.RunspacePool=$pool
      [void]$ps.AddScript($worker.ToString()).AddArgument($client).AddArgument($Root).AddArgument($App).AddArgument($origin).AddArgument($token).AddArgument($capsText).AddArgument($speechLock)
      $handle=$ps.BeginInvoke();[void]$jobs.Add(@{PowerShell=$ps;Handle=$handle})
    }else{Start-Sleep -Milliseconds 20}
  }
}finally{
  $listener.Stop();foreach($job in @($jobs.ToArray())){try{$job.PowerShell.Stop()}catch{};$job.PowerShell.Dispose()};$pool.Close();$pool.Dispose();$speechLock.Dispose()
}
