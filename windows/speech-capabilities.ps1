$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -AssemblyName System.Speech
  $languages=@([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | ForEach-Object {$_.Culture.Name} | Where-Object {$_ -in @('ja-JP','en-US')} | Select-Object -Unique)
  @{platform='windows';offlineSpeech=($languages.Count -gt 0);languages=$languages;description=('Windowsのオフライン音声認識：'+($languages -join ', ')+ '。言語がない場合はSetup-Offline-Speech.cmdでVoskを導入できます。')}|ConvertTo-Json -Compress
} catch {
  @{platform='windows';offlineSpeech=$false;languages=@();description='Windowsの音声認識を利用できません。Setup-Offline-Speech.cmdでVoskを導入してください。'}|ConvertTo-Json -Compress
}
