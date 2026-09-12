# Changelog

## 0.6.0
- New "Signal Deck" visual design: dark operator console, amber lamp accent, monospace metrics, larger touch targets.
- New app icon and Android status/navigation bar theme matching the design.
- Hero copy now covers human and AI conversations equally.

## 0.5.0
- Add ten editable conversation topics and four complementary A/B conversation styles.
- Add a visible single-device real-model / numeric-PCM trial entry point.
- Queue one human topic at the next local turn via the existing Morse link, with explicit origin and cancellation.
- Retry empty/repetitive/over-budget candidates once before sending; never truncate or substitute model output.
- Bound exact recent history while preserving normal native cache-prefix reuse.
- Add topic, steering, cancellation, privacy, UI and real-model multi-topic regression checks.

## 0.4.0
- Offline QR creation/PNG export/camera scanning/image import with explicit preview and confirmation.
- Two-party encrypted online Morse symbols, invite expiry, nonce proof, replay rejection and bounded relay.
- Manual online text/emoji exchange without a model, or existing Gemma automatic conversation.
- Docker+Caddy self-hosted relay; no preconfigured or operated public relay.
- Camera permission scoping and track cleanup, no automatic AI/capture/connect on QR scan.
- Portable bundler uses callback replacement to preserve literal dollar sequences in vendored scripts.
- Real QR, virtual-camera, encrypted loopback, browser and exact-APK regression harnesses.


## 0.3.1
- Add readiness checklist, pairing-code validation, editable topic presets, reachable stop and session counters.
- Show native copy progress and free storage; preserve busy state until native work really exits.
- Ignore stale cancelled preload failures; export bounded diagnostics without conversation text by default.
- Coalesce duplicate ACK work and bound ACK backlog without advancing rejected sequence state.
- Support numeric duplicate model filenames; make offline licenses readable without granting bridge access.
- Add native navigation/progress contract, privacy, lifecycle and duplicate-reception regression tests.


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
