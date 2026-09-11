# Implementation references

Checked during implementation, 2026-09-11. These are references for standards and platform APIs, not evidence that this application's native builds or hardware tests have passed.

- ITU-R M.1677-1, International Morse code (character symbols and 1/3/7 timing): https://www.itu.int/dms_pubrec/itu-r/rec/m/R-REC-M.1677-1-200910-I!!PDF-E.pdf
- A1 Club, Wabun Morse reference: https://a1club.org/CW_J_e.htm
- Vosk official model catalog (Japanese small0.22 48 MB, English small0.15 40 MB, model-specific licenses): https://alphacephei.com/vosk/models
- Vosk installation: https://alphacephei.com/vosk/install
- Microsoft System.Speech recognition API: https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine?view=netframework-4.8.1
- Android SpeechRecognizer, on-device factory/API31 and service availability: https://developer.android.com/reference/android/speech/SpeechRecognizer
- Android TextToSpeech: https://developer.android.com/reference/android/speech/tts/TextToSpeech
- Android local WebView content: https://developer.android.com/develop/ui/views/layout/webapps/load-local-content
- Android Gradle Plugin 8.9 compatibility: https://developer.android.com/build/releases/past-releases/agp-8-9-0-release-notes
- AudioWorklet browser API: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet
- Gradle distribution used by optional bootstrap: https://services.gradle.org/distributions/gradle-8.11.1-bin.zip

No ML Kit GenAI dependency, paid ASR service, Whisper model binary, Capacitor, Electron, or cloud conversation relay is included. The project-specific MT1 protocol and its tradeoffs are defined in PROTOCOL.md, not attributed to ITU or A1 Club.


## 0.2.0 AI Link additions (checked 2026-09-11)

- Ollama chat: https://docs.ollama.com/api/chat
- Ollama FAQ (cloud disable, local port, keep_alive): https://docs.ollama.com/faq
- llama.cpp server: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- AudioWorklet block processing: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process
- Android ADB: https://developer.android.com/tools/adb
- Android network security configuration: https://developer.android.com/privacy-and-security/security-config
- ITU Morse recommendation index: https://www.itu.int/rec/R-REC-M.1677/en

These documents inform interfaces and conventional timing; they do not validate this application, its model output, acoustic range or device performance. MT2 is experimental.
