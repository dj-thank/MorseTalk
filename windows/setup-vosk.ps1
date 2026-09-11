# Explicit optional setup: installs an isolated Python environment and a public Vosk model.
# Running this script consents to downloading packages and the Japanese model, not audio upload.
param([ValidateSet('ja-JP','en-US')][string]$Language='ja-JP')
$ErrorActionPreference='Stop'
$Root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $Root
Write-Host 'MorseTalk: 無料のVosk音声認識を端末内に導入します。'
Write-Host 'Pythonパッケージと公開モデルをダウンロードします。音声データは送信しません。'
Write-Host '必要条件: Windows x64 と Python 3.10以降（推奨3.11/3.12）。'
$answer=Read-Host '続けるには YES と入力してください'
if($answer -cne 'YES'){Write-Host '中止しました。';exit 0}
if(-not (Get-Command py.exe -ErrorAction SilentlyContinue)){throw 'Pythonが見つかりません。python.orgからPythonを導入して再実行してください。管理者権限は不要です。'}
if(-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')){
  & py.exe -3 -m venv .venv
  if($LASTEXITCODE -ne 0){throw '仮想環境の作成に失敗しました。'}
}
& .\.venv\Scripts\python.exe -m pip install -r requirements-offline-speech.txt
if($LASTEXITCODE -ne 0){throw 'Voskの導入に失敗しました。'}
& .\.venv\Scripts\python.exe tools\download_model.py --language $Language
if($LASTEXITCODE -ne 0){throw 'モデルの取得に失敗しました。'}
Write-Host '導入完了。Start-Windows.cmdを再起動してください。以後の認識はオフラインで行えます。'
