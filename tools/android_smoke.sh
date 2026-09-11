#!/usr/bin/env bash
set -euo pipefail
mkdir -p test-results/android
collect() {
  adb logcat -d > test-results/android/logcat.txt 2>&1 || true
  adb exec-out run-as jp.morsetalk.app cat files/smoke-result.json > test-results/android/smoke-result.json 2>/dev/null || true
  adb exec-out run-as jp.morsetalk.app cat files/smoke-ai.png > test-results/android/smoke-ai.png 2>/dev/null || true
}
trap collect EXIT
adb wait-for-device
# The stock launcher can ANR during cold boot on a CPU-limited CI host.
# Stop only that unrelated launcher; never suppress MorseTalk ANRs.
adb shell am force-stop com.google.android.apps.nexuslauncher
adb logcat -c
adb install -r -g android/app/build/outputs/apk/debug/app-debug.apk
adb install -r -g android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb reverse tcp:11434 tcp:11434
adb shell am instrument -w -r -e model "${MORSETALK_AI_MODEL:-qwen2.5:0.5b}" \
  jp.morsetalk.app.test/jp.morsetalk.app.SmokeInstrumentation | tee test-results/android/instrumentation.txt
grep -q MORSETALK_SMOKE_OK test-results/android/instrumentation.txt
! grep -q MORSETALK_SMOKE_FAILED test-results/android/instrumentation.txt
