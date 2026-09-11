# Security and privacy boundaries

## What stays local

App JavaScript, tone generation, PCM parsing, symbol decoding, CRC verification, and conversation state are local. No analytics SDK, external font, ad service, account login, API key or cloud language model is included. Speech is converted by a locally installed Vosk model / Windows System.Speech or Android's specifically on-device SpeechRecognizer factory. TTS chooses a local voice; missing local voices fail rather than selecting a network voice.

Recognition-model/language downloads and development tool downloads require internet. They are separate from conversation operation. Actual network traffic of the OS and its recognition/TTS service has not been measured on a physical device in this delivery. A privacy-sensitive deployment must complete the offline device gate.

## Threat model

A nearby third party can hear, record, replay, corrupt or forge Morse tones. CRC32 detects transmission damage, not a malicious sender. The 4-digit code is a group filter, not a password. Message IDs are deduplication/ACK correlation fields, not authentication. Anyone who can create a matching frame can spoof an ACK. This app is unsuitable for secrets, safety-critical control, emergency signaling, or authenticated identity.

Limits reduce denial-of-service exposure; they cannot prevent acoustic jamming or guarantee availability. Physical media, microphone hardware, OS audio processing and local applications are outside the protocol's trust boundary.

## Local server

The Python and PowerShell servers bind only IPv4 loopback `127.0.0.1`, not the LAN. Requests require the exact Host, API calls require a per-process random token, and transcription POSTs require the exact local Origin. Cross-site Fetch metadata is rejected. There is no CORS wildcard. Static serving is confined to `app/` and a small file-extension allowlist. Paths with traversal, backslash or NUL are rejected. Responses use no-store, CSP, nosniff, same-origin resource policy and a microphone-only permissions policy.

The Python HTTP server caps worker count at 8; PowerShell uses four worker runspaces and a bounded queue. Network read/write timeouts and a single speech-recognition lock are applied. Audio bodies require a bounded canonical WAV. The local API is not a general-purpose public web service. Do not reverse-proxy it, bind it to the internet, or remove its token/origin protections. Other processes already executing as the same OS user are not treated as hostile isolated tenants.

System.Speech runs with a process deadline and uses a temporary WAV deleted after recognition. The model/Vosk pathway processes memory data; transcripts are not intentionally written to logs. User recordings saved via WAV/export are user-controlled persistent files and not automatically erased.

## Android boundary

A WebView serves bundled files from a synthetic HTTPS origin. Every nonlocal request and navigation is rejected. File URL access is disabled, arbitrary frame embedding is denied by CSP, and there is no external-browser navigation through the trusted bridge. JavaScript interface methods are allowlisted, ID/parameter bounded and dispatched to the main thread. The trusted UI never inserts transcript text as HTML.

Only audio capture is granted, after checking origin and runtime microphone permission; camera/geolocation requests are not granted. Selected import/export documents use Android's system document picker rather than broad storage access. Backups are disabled. Keep-screen-on is only requested for an active foreground operation. Pausing the Activity cancels recognition/TTS and asks the UI to release Web Audio. That lifecycle behavior still needs a real-device test.

## Persistence and supply chain

Conversation history is memory-only by default. Opting into local storage persists up to 50 messages. Clear removes the app copy; exported files, OS backups, screenshots and browser/profile copies are separate. No encryption-at-rest claim is made.

Vosk model binaries, Gradle, Android SDK and fonts are not redistributed in this package. Download helpers use explicit upstream HTTPS URLs, size limits, staged extraction and path/symlink checks. The model helper records the actual SHA-256; it does not claim that this is an upstream signed hash. `--sha256` lets the developer enforce an independently obtained model hash. Gradle bootstrap checks the official SHA-256 sidecar; trust in the upstream HTTPS endpoint remains required. CI action tags are configured, but production maintainers should review and pin trusted action revisions according to their policy.

## Known operational limits

No background recording, no stealth capture, no automatic cloud fallback, no automatic publication. No live Internet endpoint was deployed. Android build / device validation and Windows runtime validation remain open acceptance gates. See `DEVICE-TEST-PLAN.md`.
