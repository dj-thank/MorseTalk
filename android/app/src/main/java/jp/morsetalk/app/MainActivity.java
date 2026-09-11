package jp.morsetalk.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Trusted, bundled UI only. No remote pages, cloud recognizer fallback, or audio upload. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String ORIGIN = "https://" + HOST;
    private static final int MICROPHONE = 10, SAVE_FILE = 11, OPEN_FILE = 12, IMPORT_MODEL = 13;
    private static final int MAX_SAVE = 20 * 1024 * 1024;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService fileWorker = Executors.newSingleThreadExecutor();
    private final AiClient aiClient = new AiClient();
    private String aiId, importModelId;
    private LocalGemma localGemma;
    private WebView web;
    private TextToSpeech tts;
    private boolean ttsReady, foreground, destroyed;
    private SpeechRecognizer recognizer;
    private String recognitionId, speakId;
    private PermissionRequest webPermission;
    private Runnable afterPermission;
    private ValueCallback<Uri[]> fileChooser;
    private String saveId;
    private byte[] saveBytes;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        localGemma = new LocalGemma(getApplicationContext());
        FrameLayout layout = new FrameLayout(this);
        web = new WebView(this);
        layout.addView(web, new FrameLayout.LayoutParams(-1, -1));
        // Target SDK 35 edge-to-edge: keep every control outside system bars/cutouts/IME.
        layout.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        setContentView(layout);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // User-selected SAF WAV documents only.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        settings.setGeolocationEnabled(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.addJavascriptInterface(new Bridge(), "NativeBridge");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetResponse(request);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Navigation is not needed. Also prevent local assets from changing bridge context.
                String url = request.getUrl().toString();
                if (!displayPage(url)) return true;
                if (!trustedPage(url)) {
                    cancelAI(); cancelRecognition("画面を移動しました。"); stopSpeaking();
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
                return false;
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!displayPage(url)) view.stopLoading();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                ui.post(() -> {
                    if (!foreground || !trusted(request.getOrigin()) || webPermission != null) { request.deny(); return; }
                    boolean audio = false;
                    for (String resource : request.getResources()) if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) audio = true;
                    if (!audio) { request.deny(); return; }
                    webPermission = request;
                    requestMicrophone(() -> {
                        PermissionRequest pending = webPermission; webPermission = null;
                        if (pending != null) {
                            if (foreground && hasMicrophone()) pending.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                            else pending.deny();
                        }
                    });
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (webPermission == request) webPermission = null;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChooser != null) fileChooser.onReceiveValue(null);
                fileChooser = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("audio/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"audio/wav", "audio/x-wav", "audio/wave"});
                try { startActivityForResult(intent, OPEN_FILE); }
                catch (RuntimeException ex) { fileChooser.onReceiveValue(null); fileChooser = null; }
                return true;
            }
        });
        tts = new TextToSpeech(getApplicationContext(), status -> ui.post(() -> {
            if (destroyed) return;
            ttsReady = status == TextToSpeech.SUCCESS;
            if (ttsReady) tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) { ui.post(() -> finishSpeak(id, null)); }
                @Override public void onError(String id) { ui.post(() -> finishSpeak(id, "端末の読み上げに失敗しました。")); }
            });
        }));
        web.loadUrl(ORIGIN + "/ai.html");
    }

    private static String pageBase(String url) {
        if (url == null) return "";
        int hash = url.indexOf('#');
        if (hash >= 0 && url.substring(hash + 1).matches("[A-Za-z][A-Za-z0-9_-]{0,79}")) return url.substring(0, hash);
        return url;
    }
    private static boolean aiPage(String url) { return (ORIGIN + "/ai.html").equals(pageBase(url)); }
    private static boolean trustedPage(String url) {
        return (ORIGIN + "/index.html").equals(pageBase(url)) || aiPage(url);
    }
    // License pages can be displayed, but never gain access to the JavaScript bridge.
    private static boolean displayPage(String url) {
        url = pageBase(url);
        return trustedPage(url) || (ORIGIN + "/licenses.html").equals(url) ||
            (ORIGIN + "/licenses/NOTICE.txt").equals(url) ||
            (ORIGIN + "/licenses/Apache-2.0.txt").equals(url) ||
            (ORIGIN + "/licenses/MIT-MorseTalk.txt").equals(url);
    }
    private static boolean trusted(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
    }
    private WebResourceResponse response(int status, String mime, byte[] bytes) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self'; img-src 'self' data:; connect-src 'none'; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
        return new WebResourceResponse(mime, "UTF-8", status, status == 200 ? "OK" : "Blocked", headers, new ByteArrayInputStream(bytes));
    }
    private WebResourceResponse assetResponse(WebResourceRequest request) {
        Uri uri = request.getUrl();
        try {
            if (!trusted(uri) || !"GET".equals(request.getMethod()) || uri.getQuery() != null) return response(403, "text/plain", new byte[0]);
            String path = uri.getPath();
            if (path == null || path.length() > 2048 || path.contains("\\") || path.indexOf('\0') >= 0) return response(400, "text/plain", new byte[0]);
            for (String part : path.split("/")) if (part.equals("..") || part.equals(".")) return response(400, "text/plain", new byte[0]);
            if (path.equals("/")) path = "/index.html";
            String mime;
            if (path.endsWith(".html")) mime = "text/html";
            else if (path.endsWith(".mjs") || path.endsWith(".js")) mime = "text/javascript";
            else if (path.endsWith(".css")) mime = "text/css";
            else if (path.endsWith(".svg")) mime = "image/svg+xml";
            else if (path.startsWith("/licenses/") && path.endsWith(".txt")) mime = "text/plain";
            else if (path.endsWith(".webmanifest")) mime = "application/manifest+json";
            else return response(404, "text/plain", new byte[0]);
            try (InputStream input = getAssets().open(path.substring(1))) {
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[8192]; int count;
                while ((count = input.read(buffer)) != -1) { out.write(buffer, 0, count); if (out.size() > 2_000_000) throw new java.io.IOException("Asset too large"); }
                return response(200, mime, out.toByteArray());
            }
        } catch (Exception ex) { return response(404, "text/plain", new byte[0]); }
    }

    public final class Bridge {
        @JavascriptInterface public void request(String raw) {
            // Calls arrive on WebView's bridge thread. Every Android API below runs on main.
            if (raw == null || raw.length() > 29_000_000) return;
            ui.post(() -> {
                if (destroyed || web == null || !trustedPage(web.getUrl())) return;
                String id = "";
                try {
                    JSONObject call = new JSONObject(raw); id = call.getString("id");
                    if (!id.matches("c[0-9]{1,10}")) return;
                    String method = call.getString("method");
                    JSONObject params = call.optJSONObject("params"); if (params == null) params = new JSONObject();
                    switch (method) {
                        case "capabilities": {
                            boolean local = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(MainActivity.this);
                            JSONObject result = new JSONObject().put("platform", "android").put("offlineSpeech", local)
                                .put("description", local ? "端末内の音声認識を使用します。日本語/英語のオフライン言語データが必要です。" : "この端末ではオンデバイス音声認識を利用できません（Android 12以降と対応サービスが必要）。文字入力・モールス送受信は利用できます。");
                            reply(id, result, null); break;
                        }
                        case "recognize": recognize(id, language(params)); break;
                        case "cancelRecognition": cancelRecognition("音声入力をキャンセルしました。"); reply(id, new JSONObject(), null); break;
                        case "speak": speak(id, params.getString("text"), language(params)); break;
                        case "stopSpeech": stopSpeaking(); reply(id, new JSONObject(), null); break;
                        case "setAwake":
                            if (params.optBoolean("enabled") && foreground) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                            else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                            reply(id, new JSONObject(), null); break;
                        case "saveFile": saveFile(id, params); break;
                        case "aiChat": {
                            if (!foreground || !aiPage(web.getUrl())) throw new IllegalStateException("AI画面を開いてください。");
                            if (aiId != null) throw new IllegalStateException("AIが処理中です。");
                            final String requestId = id;
                            LocalGemma.Callback callback = (result, error) -> ui.post(() -> {
                                if (requestId.equals(aiId)) { aiId = null; reply(requestId, result, error); }
                            });
                            if ("litert".equals(params.optString("provider"))) localGemma.chat(params, callback);
                            else aiClient.chat(params, callback::done);
                            aiId = id; break;
                        }
                        case "aiCapabilities":
                            reply(id, new JSONObject().put("native", true).put("provider", "litert")
                                .put("model", LocalGemma.MODEL).put("endpoint", "").put("remote", false), null); break;
                        case "openModelGuide":
                            if (!foreground || !aiPage(web.getUrl()) || aiId != null) throw new IllegalStateException("AI画面で先に処理を停止してください。");
                            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://developers.google.com/edge/litert-lm/models/gemma-4")));
                            reply(id, new JSONObject(), null); break;
                        case "localModelStatus": reply(id, localGemma.status(), null); break;
                        case "importModel": {
                            if (!foreground || !aiPage(web.getUrl()) || aiId != null || importModelId != null)
                                throw new IllegalStateException("AI画面で実行中の操作を停止してください。");
                            importModelId = id;
                            Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                            try { startActivityForResult(picker, IMPORT_MODEL); }
                            catch (RuntimeException ex) { importModelId = null; throw ex; }
                            break;
                        }
                        case "loadModel": {
                            if (!foreground || aiId != null) throw new IllegalStateException("別のAI処理が実行中です。");
                            final String requestId = id;
                            localGemma.preload(params, (result, error) -> ui.post(() -> {
                                if (requestId.equals(aiId)) { aiId = null; reply(requestId, result, error); }
                            }));
                            aiId = id; break;
                        }
                        case "unloadModel": {
                            if (!foreground || aiId != null) throw new IllegalStateException("先にAIを停止してください。");
                            final String requestId = id;
                            localGemma.unload((result, error) -> ui.post(() -> {
                                if (requestId.equals(aiId)) { aiId = null; reply(requestId, result, error); }
                            }));
                            aiId = id; break;
                        }
                        case "cancelAI": cancelAI(); reply(id, new JSONObject(), null); break;
                        default: reply(id, null, "未対応の操作です。");
                    }
                } catch (Exception ex) { if (!id.isEmpty()) reply(id, null, "端末内の処理を開始できません：" + ex.getMessage()); }
            });
        }
    }
    private void cancelAI() {
        aiClient.cancel();
        if (localGemma != null) localGemma.cancel();
        if (aiId != null) { String id = aiId; aiId = null; reply(id, null, "AI生成をキャンセルしました。"); }
    }
    private String language(JSONObject params) throws JSONException {
        String language = params.optString("language", "ja-JP");
        if (!language.equals("ja-JP") && !language.equals("en-US")) throw new JSONException("言語は日本語または英語です。");
        return language;
    }
    private void reply(String id, JSONObject result, String error) {
        if (destroyed || web == null) return;
        try {
            JSONObject payload = new JSONObject().put("id", id).put("ok", error == null);
            if (error != null) payload.put("error", error); else payload.put("result", result == null ? new JSONObject() : result);
            String script = "window.dispatchEvent(new CustomEvent('morsetalk-native-result',{detail:JSON.parse(" + JSONObject.quote(payload.toString()) + ")}));";
            web.evaluateJavascript(script, null);
        } catch (JSONException ignored) { }
    }
    private boolean hasMicrophone() { return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED; }
    private void requestMicrophone(Runnable action) {
        if (hasMicrophone()) { action.run(); return; }
        if (afterPermission != null) { action.run(); return; }
        afterPermission = action;
        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MICROPHONE);
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == MICROPHONE) { Runnable action = afterPermission; afterPermission = null; if (action != null) action.run(); }
    }

    private void recognize(String id, String language) {
        if (!foreground) { reply(id, null, "画面を開いてから音声入力してください。"); return; }
        if (recognitionId != null) { reply(id, null, "別の音声入力が進行中です。"); return; }
        if (Build.VERSION.SDK_INT < 31 || !SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) { reply(id, null, "端末内の音声認識が利用できません。文字入力を使用してください。"); return; }
        recognitionId = id;
        requestMicrophone(() -> {
            if (!id.equals(recognitionId)) return;
            if (!foreground || !hasMicrophone()) { finishRecognition(id, null, "マイクを許可してから再試行してください。"); return; }
            try {
                if (Build.VERSION.SDK_INT < 31) { finishRecognition(id, null, "Android 12以降が必要です。"); return; }
                // Deliberately never call createSpeechRecognizer(): no cloud fallback.
                recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this);
                recognizer.setRecognitionListener(new RecognitionListener() {
                    @Override public void onReadyForSpeech(Bundle params) { }
                    @Override public void onBeginningOfSpeech() { }
                    @Override public void onRmsChanged(float rmsdB) { }
                    @Override public void onBufferReceived(byte[] buffer) { }
                    @Override public void onEndOfSpeech() { }
                    @Override public void onPartialResults(Bundle results) { }
                    @Override public void onEvent(int type, Bundle params) { }
                    @Override public void onError(int error) { finishRecognition(id, null, recognitionError(error)); }
                    @Override public void onResults(Bundle results) {
                        ArrayList<String> texts = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        String text = texts == null || texts.isEmpty() ? "" : texts.get(0);
                        if (text == null || text.trim().isEmpty()) finishRecognition(id, null, "言葉を認識できませんでした。もう一度話してください。");
                        else finishRecognition(id, text, null);
                    }
                });
                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
                    .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                    .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                    .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                recognizer.startListening(intent);
                ui.postDelayed(() -> { if (id.equals(recognitionId)) finishRecognition(id, null, "音声入力がタイムアウトしました。短く区切って話してください。"); }, 25000);
            } catch (RuntimeException ex) { finishRecognition(id, null, "端末内の音声認識を開始できません。言語データとマイク権限を確認してください。"); }
        });
    }
    private String recognitionError(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "マイクの権限がありません。設定から許可してください。";
            case SpeechRecognizer.ERROR_NO_MATCH: return "言葉を認識できませんでした。もう一度話してください。";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "声を検出できませんでした。マイクを確認してください。";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "音声認識が使用中です。他の音声アプリを閉じて再試行してください。";
            case 12: case 13: return "指定言語の端末内モデルがありません。端末の音声入力設定で日本語/英語を追加してください。";
            default: return "端末内の音声認識エラー（" + error + "）。外部の音声認識には切り替えません。";
        }
    }
    private void finishRecognition(String id, String text, String error) {
        if (!id.equals(recognitionId)) return;
        recognitionId = null;
        SpeechRecognizer old = recognizer; recognizer = null;
        if (old != null) { old.cancel(); old.destroy(); }
        try { reply(id, text == null ? null : new JSONObject().put("text", text), error); }
        catch (JSONException ignored) { reply(id, null, "認識結果を読み込めませんでした。"); }
    }
    private void cancelRecognition(String reason) { if (recognitionId != null) finishRecognition(recognitionId, null, reason); }

    private void speak(String id, String text, String language) {
        if (!foreground || !ttsReady || tts == null) { reply(id, null, "端末内の読み上げ音声を準備できません。音声設定を確認してください。"); return; }
        if (text.trim().isEmpty() || text.length() > 2000) { reply(id, null, "読み上げる文章の長さが不正です。"); return; }
        Voice selected = null;
        if (tts.getVoices() != null) for (Voice voice : tts.getVoices()) {
            if (!voice.isNetworkConnectionRequired() && voice.getLocale().getLanguage().equals(Locale.forLanguageTag(language).getLanguage())) {
                selected = voice;
                if (voice.getLocale().toLanguageTag().equals(language)) break;
            }
        }
        if (selected == null) { reply(id, null, "指定言語のオフライン読み上げ音声がありません。端末の音声設定で追加してください。文字の受信は完了しています。"); return; }
        stopSpeaking();
        if (tts.setVoice(selected) != TextToSpeech.SUCCESS) { reply(id, null, "端末内の読み上げ音声を選択できませんでした。"); return; }
        speakId = id;
        if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, new Bundle(), id) == TextToSpeech.ERROR) finishSpeak(id, "読み上げを開始できませんでした。");
        ui.postDelayed(() -> { if (id.equals(speakId)) { if (tts != null) tts.stop(); finishSpeak(id, "読み上げがタイムアウトしました。"); } }, 85000);
    }
    private void finishSpeak(String id, String error) { if (id.equals(speakId)) { speakId = null; reply(id, new JSONObject(), error); } }
    private void stopSpeaking() { if (tts != null) tts.stop(); if (speakId != null) finishSpeak(speakId, null); }

    private void saveFile(String id, JSONObject params) throws JSONException {
        if (saveId != null) { reply(id, null, "別の保存操作が進行中です。"); return; }
        String name = params.getString("filename"), mime = params.getString("mime"), encoded = params.getString("base64");
        if (!name.matches("[A-Za-z0-9_.-]{1,100}") || !(mime.equals("audio/wav") || mime.equals("application/json"))) throw new JSONException("保存形式が不正です。");
        if (encoded.length() > ((MAX_SAVE + 2) / 3) * 4) throw new JSONException("保存は20 MBまでです。");
        byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
        if (bytes.length > MAX_SAVE) throw new JSONException("保存は20 MBまでです。");
        saveBytes = bytes; saveId = id;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE, name);
        try { startActivityForResult(intent, SAVE_FILE); }
        catch (RuntimeException ex) { saveId = null; saveBytes = null; reply(id, null, "保存先を開けませんでした。"); }
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == IMPORT_MODEL && importModelId != null) {
            String id = importModelId; importModelId = null;
            Uri uri = data == null ? null : data.getData();
            if (resultCode != RESULT_OK || uri == null) { reply(id, null, "モデル取り込みをキャンセルしました。"); return; }
            try {
                if (aiId != null) throw new IllegalStateException("別のAI処理が実行中です。");
                localGemma.importModel(uri, (result, error) -> ui.post(() -> {
                    if (id.equals(aiId)) { aiId = null; reply(id, result, error); }
                    if (!destroyed && web != null) web.evaluateJavascript("window.dispatchEvent(new Event('morsetalk-local-model'));", null);
                }));
                aiId = id;
                web.evaluateJavascript("window.dispatchEvent(new Event('morsetalk-local-import-start'));", null);
            } catch (Exception ex) { reply(id, null, ex.getMessage()); }
        } else if (requestCode == OPEN_FILE && fileChooser != null) {
            fileChooser.onReceiveValue(resultCode == RESULT_OK && data != null && data.getData() != null ? new Uri[]{data.getData()} : null); fileChooser = null;
        } else if (requestCode == SAVE_FILE && saveId != null) {
            String id = saveId; byte[] bytes = saveBytes; saveId = null; saveBytes = null;
            Uri uri = data == null ? null : data.getData();
            if (resultCode != RESULT_OK || uri == null) { reply(id, null, "保存をキャンセルしました。"); return; }
            fileWorker.execute(() -> {
                String error = null;
                try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new java.io.IOException("保存先を開けません。");
                    output.write(bytes);
                } catch (Exception ex) { error = "ファイルを保存できませんでした。"; }
                String result = error; ui.post(() -> reply(id, new JSONObject(), result));
            });
        }
    }
    @Override protected void onResume() { super.onResume(); foreground = true; if (web != null) { web.onResume(); if (trustedPage(web.getUrl())) web.evaluateJavascript("window.dispatchEvent(new Event('morsetalk-native-resume'));", null); } }
    @Override protected void onPause() {
        foreground = false;
        cancelAI();
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        cancelRecognition("画面を離れたため音声入力を停止しました。"); stopSpeaking();
        if (webPermission != null) { webPermission.deny(); webPermission = null; }
        // Let the trusted page release its Web Audio microphone and oscillator, then pause.
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('morsetalk-native-pause'));", value -> { if (!foreground && web != null) web.onPause(); });
        super.onPause();
    }
    @Override protected void onDestroy() {
        cancelAI(); aiClient.close();
        if (localGemma != null) localGemma.close();
        importModelId = null;
        cancelRecognition("アプリを終了しました。"); stopSpeaking(); destroyed = true;
        if (tts != null) { tts.shutdown(); tts = null; }
        if (fileChooser != null) { fileChooser.onReceiveValue(null); fileChooser = null; }
        afterPermission = null; saveBytes = null; saveId = null;
        ui.removeCallbacksAndMessages(null); fileWorker.shutdown();
        if (web != null) { web.removeJavascriptInterface("NativeBridge"); web.destroy(); web = null; }
        super.onDestroy();
    }
    @Override public void onBackPressed() {
        if (web != null && !trustedPage(web.getUrl()) && web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }
}
