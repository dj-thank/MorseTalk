# Third-party notices and optional components

Original MorseTalk application, DSP, framing, test, bridge and helper code is provided under the included MIT License.

No third-party JavaScript runtime bundle, model weights, Android SDK binaries, Gradle distribution, proprietary font files, or OS speech voices are included in the source archive. The font family names in CSS select fonts already installed on the user's system; they do not download or distribute fonts.

## Optional Vosk

- Vosk API package `vosk==0.3.45`: Apache-2.0 upstream. Installed only by the explicit optional setup helper. Its transitive dependencies have their own licenses.
- Japanese `vosk-model-small-ja-0.22`: Apache-2.0 in the upstream model catalog, approximately48 MB download.
- English `vosk-model-small-en-us-0.15`: Apache-2.0 in the upstream model catalog, approximately40 MB download.
- Catalog: https://alphacephei.com/vosk/models
- Project: https://github.com/alphacep/vosk-api

Models are downloaded separately, with the upstream archive's files intact, to `models/`. The helper records source, actual hash and license metadata. It does not manufacture an upstream signature. Re-distributors who bundle a model or dependency must include the applicable upstream license/notice files and verify current terms.

## Platform and build tools

Android SpeechRecognizer/TextToSpeech/WebView and Windows System.Speech/browser speech voices are supplied by the user's OS/service provider and are not re-licensed by this project's MIT License. Service and voice-data terms apply independently.

Gradle 8.11.1 and Android Gradle Plugin 8.9.2 are development dependencies. Android SDK terms require the developer's own review/acceptance. Playwright is an optional test-only dependency. The optional build helper downloads Gradle from its official distribution and verifies its official SHA-256 sidecar; no Gradle executable is shipped here.

## Morse standards

Character code assignments and timing conventions are used for interoperability. No full text of the ITU recommendation or third-party reference article is reproduced. MT1 and MT2 are our own nonstandard transports, not a standard or endorsement by those organizations. See docs/SOURCES.md.

## Optional AI server and model

Ollama and llama.cpp are optional, separately installed backends. Their executables, source and model weights are not bundled here. The user selects an already installed model and must verify that model's license and resource requirements independently. This app's MIT license does not grant rights in any chosen model. No model download, API purchase, API key, proprietary font file or third-party JS runtime is included. See docs/AI-SETUP.md for the primary API documentation used.

## 0.3.0 runtime
APK includes unmodified LiteRT-LM0.17.0 and Kotlin/coroutines dependencies (Apache-2.0). License text and attribution are in assets/licenses. Model weights are not bundled. Other upstream native dependencies retain their respective terms; a complete source-level native audit is not claimed.
