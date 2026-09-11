# Changelog

## 0.2.2
- Restore missing Windows launchers and verification source as ordinary tracked files.
- Fix WebView microphone startup by requesting MODIFY_AUDIO_SETTINGS in addition to RECORD_AUDIO.
- Keep Android 8.0 theme resources compatible and pass Android Lint without suppressing errors.
- Reject pending audio transmission on processor failure or microphone loss; release all resources even when a terminated node throws.
- Ignore stale callbacks from stopped audio sessions; add regression tests.
- Preserve strict CSP while verifying real Chromium capture and real-time virtual audio.
- Isolate ASR test history and make model registry retries bounded and auditable.
- Verify debug APK installation, native Java real-LLM connection, receiver start/stop, Windows runtime, and four exact real-LLM audio turns in CI.
- Physical two-phone acoustics and real-device ASR/TTS quality remain unverified.

## 0.2.1
- Fix MT2 receiver dependency on unavailable AudioWorklet TextEncoder/TextDecoder globals.
- Preserve leading Unicode BOM as payload; reject malformed UTF-8 strictly.
- Add 33 UTF-8 and complete-worklet regression cases.
- Add container CI, real Chromium capture, real LLM/audio, Windows and Android runtime verification.
- Add Android instrumentation and debug APK signature checks.
- Keep MT1 translation and MT2 wire compatibility. Physical two-device acoustics remain unverified.

## 0.2.0
- MT2 high-speed Morse, bounded two-agent dialogue, explicit local AI adapters.
