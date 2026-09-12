package jp.morsetalk.app;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Proxy;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

/** Explicit text-only AI bridge. No redirects, TLS bypass, model downloads, or tool execution. */
final class AiClient {
    interface Callback { void done(JSONObject result, String error); }
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicLong generation = new AtomicLong();
    private volatile HttpURLConnection current;
    private boolean busy;

    synchronized void chat(JSONObject params, Callback callback) throws Exception {
        if (busy) throw new IllegalStateException("AIが処理中です。");
        if (!params.optBoolean("consent", false)) throw new IllegalArgumentException("AIへの会話送信許可が必要です。");
        String endpoint = params.getString("endpoint"), provider = params.optString("provider", "ollama"), model = params.getString("model");
        if (endpoint.length() > 2048 || model.trim().isEmpty() || model.length() > 120 || model.matches("(?s).*[\\x00-\\x1f].*")) throw new IllegalArgumentException("AI設定が不正です。");
        URI uri = new URI(endpoint);
        String scheme = uri.getScheme(), host = uri.getHost();
        if (uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null || host == null || (uri.getPort() != -1 && (uri.getPort() < 1 || uri.getPort() > 65535))) throw new IllegalArgumentException("AI URLが不正です。");
        boolean loopback = "127.0.0.1".equals(host);
        if (!("https".equals(scheme) || ("http".equals(scheme) && loopback))) throw new IllegalArgumentException("AI接続は127.0.0.1のHTTP、またはHTTPSだけです。");
        if (!("ollama".equals(provider) || "compatible".equals(provider))) throw new IllegalArgumentException("API方式が不正です。");
        JSONArray messages = params.getJSONArray("messages"), clean = new JSONArray();
        if (messages.length() < 1 || messages.length() > 25) throw new IllegalArgumentException("履歴は1〜25件です。");
        int total = 0;
        for (int i = 0; i < messages.length(); i++) {
            JSONObject m = messages.getJSONObject(i);
            String role = m.getString("role"), content = m.getString("content");
            if (!(role.equals("system") || role.equals("user") || role.equals("assistant")) || (role.equals("system") && i != 0)) throw new IllegalArgumentException("会話ロールが不正です。");
            int bytes = content.getBytes(StandardCharsets.UTF_8).length;
            if (content.trim().isEmpty() || bytes > 8000) throw new IllegalArgumentException("会話本文が不正です。");
            total += bytes;
            clean.put(new JSONObject().put("role", role).put("content", content));
        }
        if (total > 24000) throw new IllegalArgumentException("履歴が長すぎます。");
        JSONObject request = new JSONObject().put("model", model).put("messages", clean).put("stream", false);
        if (provider.equals("ollama")) request.put("think", false).put("keep_alive", "10m").put("options", new JSONObject().put("num_predict", 96).put("num_ctx", 4096).put("temperature", .3));
        else request.put("max_tokens", Math.max(32, Math.min(384, params.optInt("maxTokens",96)))).put("temperature", .3);
        if (provider.equals("compatible") && params.optBoolean("structuredDiscussion",false)) {
            JSONObject properties=new JSONObject();
            for(String key:new String[]{"understanding","focus","reply"}) properties.put(key,new JSONObject().put("type","string"));
            // Leave room to finish a natural Japanese sentence; the prompt
            // still asks for one short point per acoustic turn.
            properties.getJSONObject("reply").put("maxLength",24);
            JSONObject schema=new JSONObject().put("type","object").put("properties",properties).put("required",new JSONArray().put("understanding").put("focus").put("reply")).put("additionalProperties",false);
            request.put("response_format",new JSONObject().put("type","json_schema").put("json_schema",new JSONObject().put("name","discussion").put("strict",true).put("schema",schema)));
        }
        byte[] body = request.toString().getBytes(StandardCharsets.UTF_8);
        if (body.length > 32768) throw new IllegalArgumentException("AIリクエストが大きすぎます。");
        busy = true;
        long epoch = generation.incrementAndGet();
        executor.execute(() -> {
            JSONObject result = null; String error = null; HttpURLConnection conn = null;
            try {
                if (epoch != generation.get()) return;
                conn = (HttpURLConnection) uri.toURL().openConnection(Proxy.NO_PROXY);
                current = conn;
                conn.setInstanceFollowRedirects(false); conn.setConnectTimeout(10000); conn.setReadTimeout(90000);
                conn.setRequestMethod("POST"); conn.setDoOutput(true); conn.setRequestProperty("Content-Type", "application/json"); conn.setFixedLengthStreamingMode(body.length);
                if (epoch != generation.get()) return;
                try (OutputStream output = conn.getOutputStream()) { output.write(body); }
                int status = conn.getResponseCode();
                if (status != 200) throw new IllegalStateException("AIサーバー HTTP " + status + "。URL・モデル・API方式を確認してください。");
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                try (InputStream input = conn.getInputStream()) {
                    byte[] buffer = new byte[4096]; int n;
                    while ((n = input.read(buffer)) != -1) {
                        output.write(buffer, 0, n);
                        if (output.size() > 131072 || epoch != generation.get()) throw new IllegalStateException("AI応答の上限超過または中止。");
                    }
                }
                JSONObject data = new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
                String text = provider.equals("ollama") ? data.getJSONObject("message").getString("content") : data.getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content");
                if (text.trim().isEmpty() || text.getBytes(StandardCharsets.UTF_8).length > 8192) throw new IllegalStateException("AI文章が空か長すぎます。ツール呼び出しは実行しません。");
                result = new JSONObject().put("text", text.trim()).put("model", model).put("provider", provider).put("remote", !loopback);
            } catch (Exception ex) { error = "AI接続に失敗しました：" + ex.getMessage(); }
            finally {
                if (conn != null) conn.disconnect();
                if (current == conn) current = null;
                synchronized (AiClient.this) { if (generation.get() == epoch) busy = false; }
                if (epoch == generation.get()) callback.done(result, error);
            }
        });
    }
    synchronized void cancel() {
        generation.incrementAndGet(); busy = false;
        HttpURLConnection c = current; current = null;
        if (c != null) c.disconnect();
    }
    void close() { cancel(); executor.shutdownNow(); }
}
