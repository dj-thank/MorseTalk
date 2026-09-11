#!/usr/bin/env bash
# Real .litertlm + actual installed APK. No Ollama, no adb reverse, no AI test double.
set -euo pipefail
mkdir -p test-results/android-local
collect() {
  adb logcat -d > test-results/android-local/logcat.txt 2>&1 || true
  adb exec-out run-as jp.morsetalk.app cat files/smoke-result.json > test-results/android-local/smoke-result.json 2>/dev/null || true
  adb exec-out run-as jp.morsetalk.app cat files/smoke-ai.png > test-results/android-local/smoke-ai.png 2>/dev/null || true
  adb exec-out run-as jp.morsetalk.app cat files/smoke-failure.png > test-results/android-local/smoke-failure.png 2>/dev/null || true
  adb shell dumpsys meminfo jp.morsetalk.app > test-results/android-local/memory-after-test.txt 2>&1 || true
}
trap collect EXIT
adb wait-for-device
adb shell am force-stop com.google.android.apps.nexuslauncher
adb install -r -g android/app/build/outputs/apk/debug/app-debug.apk
adb install -r -g android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
# Provision only the known fixed model into the installed debug application's private files.
adb shell run-as jp.morsetalk.app mkdir -p files/models
adb shell run-as jp.morsetalk.app sh -c '"cat > files/models/gemma-4-E2B-it.litertlm"' < .models/gemma-4-E2B-it.litertlm
adb exec-out run-as jp.morsetalk.app sha256sum files/models/gemma-4-E2B-it.litertlm > test-results/android-local/device-model-sha256.txt
python3 - <<'PY'
import json
from pathlib import Path
expected=json.loads(Path('test-results/local-model-provenance.json').read_text())['sha256']
actual=Path('test-results/android-local/device-model-sha256.txt').read_text().split()[0]
assert actual==expected, 'Device model differs from verified download'
PY
adb logcat -c
adb shell svc wifi disable
adb shell svc data disable
# The app model source is a private local file; inference has no HTTP fallback.
timeout 1000 adb shell am instrument -w -r -e local_model true \
  jp.morsetalk.app.test/jp.morsetalk.app.SmokeInstrumentation | tee test-results/android-local/instrumentation.txt
grep -q MORSETALK_SMOKE_OK test-results/android-local/instrumentation.txt
! grep -q MORSETALK_SMOKE_FAILED test-results/android-local/instrumentation.txt
