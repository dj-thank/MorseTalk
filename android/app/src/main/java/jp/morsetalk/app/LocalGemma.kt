package jp.morsetalk.app

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.SamplerConfig
import com.google.ai.edge.litertlm.ThinkingConfig
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.concurrent.CancellationException
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONArray
import org.json.JSONObject

/** One native engine per app. No HTTP, cloud fallback, tools or background conversation. */
class LocalGemma(context: Context) : AutoCloseable {
    fun interface Callback { fun done(result: JSONObject?, error: String?) }
    private val app = context.applicationContext
    private val worker = Executors.newSingleThreadExecutor()
    private val busy = AtomicBoolean(false)
    private val epoch = AtomicLong()
    private val guard = Any()
    private val directory = File(app.filesDir, "models")
    private val modelFile = File(directory, MODEL)
    @Volatile private var closed = false
    @Volatile private var phase = "未読込"
    @Volatile private var loadedBackend = ""
    @Volatile private var digest = ""
    @Volatile private var loaded = false
    private var engine: Engine? = null
    // Accessed on worker, except cancelProcess, which is guarded against close.
    private var conversation: Conversation? = null
    private var history: List<Pair<String, String>> = emptyList()

    fun status(): JSONObject = JSONObject()
        .put("model", MODEL).put("provider", "litert").put("remote", false)
        .put("installed", modelFile.isFile).put("loaded", loaded)
        .put("busy", busy.get()).put("backend", loadedBackend)
        .put("bytes", modelFile.length()).put("sha256", digest)
        .put("identityVerified", false)
        .put("description", "Gemma 4 E2B · $phase · " +
            if (modelFile.isFile) "モデル ${(modelFile.length() / 1048576)} MiB。端末内のみ。" else "gemma-4-E2B-it.litertlm を取り込んでください。")

    private fun checkCurrent(id: Long) {
        if (closed || id != epoch.get()) throw CancellationException("停止しました。")
    }

    private fun work(callback: Callback, action: (Long) -> JSONObject) {
        check(!closed) { "AIエンジンは終了済みです。" }
        check(busy.compareAndSet(false, true)) { "モデル処理中です。停止した処理の終了後に再開してください。" }
        val id = epoch.incrementAndGet()
        worker.execute {
            var result: JSONObject? = null
            var error: String? = null
            try {
                checkCurrent(id)
                result = action(id)
                checkCurrent(id)
            } catch (ex: Exception) {
                error = "端末内Gemma: ${ex.message ?: ex.javaClass.simpleName}"
                discardConversation()
            } catch (ex: LinkageError) {
                error = "この端末でLiteRT-LMを読み込めません: ${ex.message}"
                discardConversation()
            } catch (ex: OutOfMemoryError) {
                error = "Gemmaの実行メモリが不足しています。他のアプリを閉じてください。"
                discardConversation()
            } finally {
                if (id != epoch.get()) discardConversation()
                phase = if (loaded) "読込済み ($loadedBackend)" else "未読込"
                busy.set(false) // Do not admit another native operation before this one has actually exited.
                if (!closed && id == epoch.get()) callback.done(result, error)
            }
        }
    }

    private fun backend(params: JSONObject): String {
        val value = params.optString("backend", "cpu")
        require(value == "cpu" || value == "gpu") { "実行方式はCPUまたはGPUです。" }
        return value
    }

    private fun requireConsent(params: JSONObject) {
        require(params.opt("consent") == true) { "端末内AIで会話を処理する許可が必要です。" }
        require(params.optString("model", MODEL) == MODEL) { "端末内モデルは $MODEL です。" }
    }

    private fun ensureLoaded(id: Long, backendName: String): Double {
        if (engine != null && loadedBackend == backendName) return 0.0
        releaseEngine()
        check(modelFile.isFile && modelFile.length() >= MIN_BYTES) { "Gemma 4 E2Bモデルを取り込んでください。" }
        phase = "読み込み中 ($backendName)"
        val cache = File(app.cacheDir, "gemma4-$backendName").apply { mkdirs() }
        val start = System.nanoTime()
        // Respect the .litertlm model's KV-cache default; no maxNumTokens override.
        val candidate = Engine(EngineConfig(modelPath = modelFile.absolutePath,
            backend = if (backendName == "gpu") Backend.GPU() else Backend.CPU(threadCount = 2),
            cacheDir = cache.absolutePath))
        try {
            candidate.initialize()
            checkCurrent(id)
            engine = candidate
            loadedBackend = backendName
            loaded = true
            return (System.nanoTime() - start) / 1_000_000.0
        } catch (ex: Throwable) {
            try { candidate.close() } catch (_: Exception) { }
            throw ex
        }
    }

    fun preload(params: JSONObject, callback: Callback) {
        requireConsent(params)
        val selected = backend(params)
        work(callback) { id ->
            val ms = ensureLoaded(id, selected)
            status().put("loadMs", ms).put("loaded", true)
                .put("description", "Gemma 4 E2B · 読込済み ($selected) · 読込 ${"%.0f".format(ms)} ms。端末内のみ。")
        }
    }

    fun chat(params: JSONObject, callback: Callback) {
        requireConsent(params)
        val selected = backend(params)
        val messages = validateMessages(params.getJSONArray("messages"))
        work(callback) { id ->
            val loadMs = ensureLoaded(id, selected)
            checkCurrent(id)
            phase = "生成中 ($selected)"
            val reused = conversation != null && messages.size == history.size + 1 && messages.dropLast(1) == history
            if (!reused) {
                discardConversation()
                val prefix = messages.dropLast(1)
                val system = prefix.firstOrNull()?.takeIf { it.first == "system" }?.second
                val initial = prefix.filter { it.first != "system" }.map {
                    if (it.first == "assistant") Message.model(it.second) else Message.user(it.second)
                }
                val fresh = engine!!.createConversation(ConversationConfig(
                    systemInstruction = system?.let { Contents.of(it) }, initialMessages = initial,
                    samplerConfig = SamplerConfig(topK = 64, topP = 0.95, temperature = 0.3),
                    automaticToolCalling = false, maxOutputToken = 96,
                    thinkingConfig = ThinkingConfig(enableThinking = false),
                    extraContext = mapOf("enable_thinking" to false)))
                synchronized(guard) { conversation = fresh }
            }
            checkCurrent(id)
            val start = System.nanoTime()
            val response = conversation!!.sendMessage(messages.last().second)
            checkCurrent(id)
            require(response.toolCalls.isEmpty()) { "ツール呼び出しは実行しません。" }
            require(response.contents.contents.all { it is Content.Text }) { "テキスト以外の応答は送信しません。" }
            val text = response.contents.toString().trim() // Never transmit thinking channels.
            require(text.isNotEmpty() && text.toByteArray(Charsets.UTF_8).size <= 8192) { "AI応答が空または長すぎます。" }
            history = messages + ("assistant" to text)
            JSONObject().put("text", text).put("model", MODEL).put("provider", "litert")
                .put("remote", false).put("backend", selected).put("loadMs", loadMs)
                .put("inferenceMs", (System.nanoTime() - start) / 1_000_000.0).put("reusedConversation", reused)
        }
    }

    /** Copies only the document chosen by the owner; never holds the 2.6 GB model in RAM. */
    fun importModel(uri: Uri, callback: Callback) {
        require(uri.scheme == "content") { "ファイル選択画面からモデルを選んでください。" }
        work(callback) { id ->
            phase = "モデル取り込み中"
            var name: String? = null
            var expected = -1L
            app.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val si = c.getColumnIndex(OpenableColumns.SIZE)
                    if (ni >= 0) name = c.getString(ni)
                    if (si >= 0 && !c.isNull(si)) expected = c.getLong(si)
                }
            }
            require(name == MODEL) { "選択するファイル名は $MODEL です。GGUFは取り込めません。" }
            require(expected == -1L || expected in MIN_BYTES..MAX_BYTES) { "モデルのサイズが不正です。" }
            check(directory.isDirectory || directory.mkdirs()) { "モデル保存先を作れません。" }
            check(directory.usableSpace >= (if (expected > 0) expected else MIN_BYTES) + RESERVE_BYTES) { "モデルのコピーに必要な空き容量がありません。" }
            val temporary = File.createTempFile("gemma4-", ".part", directory)
            try {
                val hash = MessageDigest.getInstance("SHA-256")
                var size = 0L
                app.contentResolver.openInputStream(uri).use { input ->
                    checkNotNull(input) { "選択ファイルを開けません。" }
                    FileOutputStream(temporary).use { output ->
                        val buffer = ByteArray(1024 * 1024)
                        while (true) {
                            checkCurrent(id)
                            val n = input.read(buffer)
                            if (n < 0) break
                            size += n
                            require(size <= MAX_BYTES) { "モデルサイズの上限を超えました。" }
                            check(directory.usableSpace >= RESERVE_BYTES + n) { "モデル取り込み中に空き容量が不足しました。" }
                            output.write(buffer, 0, n)
                            hash.update(buffer, 0, n)
                        }
                        output.fd.sync()
                    }
                }
                require(size >= MIN_BYTES && (expected < 0 || expected == size)) { "モデルのコピーが不完全です。" }
                checkCurrent(id)
                releaseEngine()
                checkCurrent(id)
                Files.move(temporary.toPath(), modelFile.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
                digest = hash.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
                status().put("description", "モデル取り込み完了 (${size / 1048576} MiB) · SHA-256: $digest。実行前に読込テストしてください。")
            } finally { temporary.delete() }
        }
    }

    fun unload(callback: Callback) { work(callback) { releaseEngine(); status() } }

    fun cancel() {
        epoch.incrementAndGet()
        synchronized(guard) {
            try { conversation?.cancelProcess() } catch (_: Exception) { }
        }
        if (busy.get()) phase = "停止処理中"
        // Initializing a native engine cannot be interrupted safely. The result is discarded
        // and its engine is closed when initialize returns; no late reply can be transmitted.
    }

    private fun discardConversation() {
        synchronized(guard) {
            val previous = conversation
            conversation = null
            history = emptyList()
            try { previous?.close() } catch (_: Exception) { }
        }
    }

    private fun releaseEngine() {
        discardConversation()
        val previous = engine
        engine = null
        loaded = false
        loadedBackend = ""
        try { previous?.close() } catch (_: Exception) { }
    }

    override fun close() {
        if (closed) return
        closed = true
        cancel()
        worker.execute { releaseEngine() }
        worker.shutdown()
    }

    companion object {
        const val MODEL = "gemma-4-E2B-it.litertlm"
        private const val MIN_BYTES = 100L * 1024 * 1024
        private const val MAX_BYTES = 4L * 1024 * 1024 * 1024
        private const val RESERVE_BYTES = 256L * 1024 * 1024

        @JvmStatic fun validateMessages(input: JSONArray): List<Pair<String, String>> {
            require(input.length() in 1..25) { "履歴は1〜25件です。" }
            var total = 0
            val result = (0 until input.length()).map { i ->
                val m = input.getJSONObject(i)
                val role = m.getString("role")
                val text = m.getString("content")
                require(role in listOf("system", "user", "assistant") && (role != "system" || i == 0)) { "会話ロールが不正です。" }
                val bytes = text.toByteArray(Charsets.UTF_8).size
                require(text.isNotBlank() && bytes <= 8000) { "会話本文が不正です。" }
                total += bytes
                role to text
            }
            require(total <= 24000 && result.last().first == "user") { "履歴が長すぎるか、末尾がuserではありません。" }
            return result
        }
    }
}
