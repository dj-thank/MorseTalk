# Changelog

## 0.2.1
- Fix MT2 receiver dependency on unavailable AudioWorklet TextEncoder/TextDecoder globals.
- Preserve leading Unicode BOM as payload; reject malformed UTF-8 strictly.
- Add 33 UTF-8 and complete-worklet regression cases.
- Add container CI, real Chromium capture, real LLM/audio, Windows and Android runtime verification.
- Add Android instrumentation and debug APK signature checks.
- Keep MT1 translation and MT2 wire compatibility. Physical two-device acoustics remain unverified.

## 0.2.0
- MT2 high-speed Morse, bounded two-agent dialogue, explicit local AI adapters.
