param(
  [Parameter(Mandatory=$true)][string]$WavePath,
  [ValidateSet('ja-JP','en-US')][string]$Language='ja-JP'
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$recognizer=$null
try {
  Add-Type -AssemblyName System.Speech
  $available=@([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object {$_.Culture.Name -eq $Language})
  if($available.Count -eq 0){throw "この言語のWindowsオフライン認識エンジンがありません。Windowsの音声言語を追加するか、Setup-Offline-Speech.cmdを使ってください。"}
  $info=Get-Item -LiteralPath $WavePath
  if($info.Length -gt 700000 -or $info.Length -lt 44){throw '録音データのサイズが不正です。'}
  $recognizer=New-Object System.Speech.Recognition.SpeechRecognitionEngine -ArgumentList $available[0]
  $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $recognizer.InitialSilenceTimeout=[TimeSpan]::FromSeconds(5)
  $recognizer.BabbleTimeout=[TimeSpan]::FromSeconds(5)
  $recognizer.EndSilenceTimeout=[TimeSpan]::FromMilliseconds(500)
  $recognizer.SetInputToWaveFile($info.FullName)
  $parts=New-Object 'System.Collections.Generic.List[string]'
  $deadline=[DateTime]::UtcNow.AddSeconds(35)
  for($i=0;$i -lt 30 -and [DateTime]::UtcNow -lt $deadline;$i++) {
    $result=$recognizer.Recognize([TimeSpan]::FromSeconds(3))
    if($null -eq $result){break}
    if(-not [string]::IsNullOrWhiteSpace($result.Text)){$parts.Add($result.Text)}
  }
  @{text=($parts -join ' ');offline=$true}|ConvertTo-Json -Compress
} catch {
  @{error=$_.Exception.Message}|ConvertTo-Json -Compress
  exit 1
} finally {
  if($null -ne $recognizer){$recognizer.Dispose()}
}
