package jp.morsetalk.app;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Runs the installed application, NOT a JS bridge substitute or a desktop viewport. */
public final class SmokeInstrumentation extends Instrumentation {
    private Bundle arguments;
    private WebView web;
    private Activity activity;
    private final JSONArray checks = new JSONArray();
    private final JSONObject report = new JSONObject();
    @Override public void onCreate(Bundle args) { super.onCreate(args); arguments=args; start(); }
    @Override public void onStart() {
        Bundle result=new Bundle(); boolean ok=false;
        try {
            report.put("physical_device",false).put("real_ai_bridge_tested",false);
            activity=startActivitySync(new Intent(Intent.ACTION_MAIN).setClassName(getTargetContext().getPackageName(),"jp.morsetalk.app.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            waitForIdleSync();
            runOnMainSync(() -> web=findWeb(activity.getWindow().getDecorView()));
            if(web==null)throw new AssertionError("Actual app WebView missing");
            waitJs("document.readyState==='complete' && !!document.querySelector('#self-test')",30000);
            check("Installed APK launched; bundled AI page loaded",js("location.href"));
            require("!!window.NativeBridge && typeof NativeBridge.request==='function'","Native bridge missing");
            check("Actual Android Java bridge present",true);
            require("document.documentElement.scrollWidth<=innerWidth","Horizontal overflow");
            check("Emulator WebView layout fits viewport",true);
            js("document.querySelector('#self-test').click();true");
            waitJs("document.querySelector('#diagnostic').textContent.includes('4速度すべてPCM復元一致')",20000);
            check("Four-speed production codec self-test in Android WebView",js("document.querySelector('#diagnostic').textContent"));
            js("window.workletProbe=null;(async()=>{let c;try{c=new AudioContext();await c.audioWorklet.addModule('/js/fast-worklet.mjs');const n=new AudioWorkletNode(c,'morsetalk-fast-input',{processorOptions:{wpm:1200}});n.port.postMessage({kind:'stop'});n.disconnect();window.workletProbe='ok';}catch(e){window.workletProbe=String(e);}finally{if(c)await c.close();}})();true");
            waitJs("window.workletProbe!==null",20000);
            require("window.workletProbe==='ok'","AudioWorklet module failed: "+js("window.workletProbe"));
            check("Actual WebView AudioWorklet imports and processor construction",true);
            try(OutputStream out=getTargetContext().openFileOutput("smoke-ai.png",Context.MODE_PRIVATE)) {
                Bitmap shot=getUiAutomation().takeScreenshot();
                if(shot==null)throw new AssertionError("Screenshot unavailable");
                shot.compress(Bitmap.CompressFormat.PNG,100,out);shot.recycle();
            }
            checkLocalValidation();
            checkPolishedControls();
            if (arguments != null && "true".equals(arguments.getString("local_model", "false"))) checkNativeGemma();
            String model=arguments==null?"":arguments.getString("model","");
            if(!model.isEmpty()) {
                js("document.querySelector('#provider').value='ollama';document.querySelector('#provider').dispatchEvent(new Event('change'));document.querySelector('#model').value="+JSONObject.quote(model)+";document.querySelector('#consent').checked=true;document.querySelector('#test-ai').click();true");
                waitJs("document.querySelector('#status').textContent.includes('AI APIから文章を受信')",120000);
                report.put("real_ai_bridge_tested",true).put("model",model);
                check("Android Java HttpURLConnection -> actual local LLM -> native result event",js("document.querySelector('#transcript').textContent"));
                // Physical touch gives WebAudio a genuine user gesture; no autoplay-policy bypass.
                tap("#listen");waitJs("document.querySelector('#status').textContent.includes('A：受信待機中')",30000);
                check("Android microphone permission and live receiver start (virtual emulator mic)",true);
                tap("#stop");waitJs("document.querySelector('#status').textContent==='停止しました。'",10000);
                require("!document.querySelector('#listen').disabled && document.querySelector('#stop').disabled","Stop did not restore controls");
                check("Live receiver stop restores controls",true);
            }
            runOnMainSync(() -> web.loadUrl("https://appassets.androidplatform.net/licenses.html"));
            waitJs("document.readyState==='complete' && document.body.textContent.includes('第三者ライセンス')",15000);
            js("window.deniedBridge=true;window.addEventListener('morsetalk-native-result',()=>window.deniedBridge=false);NativeBridge.request(JSON.stringify({id:'c9999999999',method:'localModelStatus',params:{}}));true");
            SystemClock.sleep(300);
            require("window.deniedBridge===true", "Display-only licenses gained bridge access");
            runOnMainSync(() -> web.loadUrl("https://appassets.androidplatform.net/licenses/Apache-2.0.txt"));
            waitJs("document.readyState==='complete' && document.body.textContent.includes('Apache License')",15000);
            check("Installed APK serves full license text without granting privileged bridge access",true);
            runOnMainSync(() -> web.loadUrl("https://appassets.androidplatform.net/index.html"));
            waitJs("document.readyState==='complete' && !!document.querySelector('#draft')",30000);
            check("Legacy voice/Morse page remains reachable",js("location.href"));
            report.put("status","passed");ok=true;
        } catch(Throwable e) {
            try {report.put("status","failed").put("error",e.toString());}catch(Exception ignored) { }
            result.putString("error",e.toString());
        } finally {
            try {report.put("checks",checks);try(OutputStream out=getTargetContext().openFileOutput("smoke-result.json",Context.MODE_PRIVATE)){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}}catch(Exception ignored) { }
            result.putString("stream",(ok?"MORSETALK_SMOKE_OK":"MORSETALK_SMOKE_FAILED")+"\n"+report.toString()+"\n");
            finish(ok?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);
        }
    }
    private void checkLocalValidation() throws Exception {
        LocalGemma.validateMessages(new JSONArray("[{\"role\":\"user\",\"content\":\"こんにちは\"}]"));
        for (String bad : new String[]{"[]", "[{\"role\":\"tool\",\"content\":\"bad\"}]", "[{\"role\":\"assistant\",\"content\":\"bad\"}]", "[{\"role\":\"user\",\"content\":\"\"}]"}) {
            boolean rejected=false;
            try { LocalGemma.validateMessages(new JSONArray(bad)); } catch(IllegalArgumentException expected) { rejected=true; }
            if(!rejected)throw new AssertionError("Invalid local conversation accepted: "+bad);
        }
        check("Local engine validates roles, empty input and user-final history",true);
        require("document.querySelector('#provider').value==='litert' && document.querySelector('#endpoint').disabled", "Android must default to on-device Gemma, not an HTTP server");
        check("Android defaults to local Gemma with no HTTP endpoint",true);
    }
    private void checkPolishedControls() throws Exception {
        for (String name : new String[]{LocalGemma.MODEL, "gemma-4-E2B-it (1).litertlm", "gemma-4-E2B-it(23).litertlm"})
            if (!LocalGemma.acceptsModelFilename(name)) throw new AssertionError("Valid filename rejected: " + name);
        for (String name : new String[]{"../../gemma-4-E2B-it.litertlm", "gemma-4-E2B-it.gguf", "gemma-4-E4B-it.litertlm", "gemma-4-E2B-it (abc).litertlm"})
            if (LocalGemma.acceptsModelFilename(name)) throw new AssertionError("Invalid filename accepted: " + name);
        check("Native importer accepts numeric duplicate suffix but rejects paths, other models and GGUF",true);
        js("window.previousSettings={role:document.querySelector('#role').value,provider:document.querySelector('#provider').value,consent:document.querySelector('#consent').checked};document.querySelector('#pairing-code').value='MT2|1234|AABBCCDD|300|4|96';document.querySelector('#apply-code').click();true");
        waitJs("document.querySelector('#session').value==='AABBCCDD' && document.querySelector('#max-bytes').value==='96'",5000);
        require("document.querySelector('#role').value===previousSettings.role && document.querySelector('#provider').value===previousSettings.provider && document.querySelector('#consent').checked===previousSettings.consent", "Pairing altered private AI state");
        check("Installed app applies connection code atomically without altering role, AI provider or consent",true);
        js("document.querySelector('#pairing-code').value='MT2|0000|20260911|600|8|180';document.querySelector('#apply-code').click();true");
        waitJs("document.querySelector('#session').value==='20260911'",5000);
        js("window.progressState=null;(async()=>{const {nativeCall}=await import('https://appassets.androidplatform.net/js/voice.mjs');progressState=await nativeCall('localModelStatus',{},5000);})();true");
        waitJs("window.progressState!==null",10000);
        require("Number.isFinite(progressState.freeBytes)&&progressState.freeBytes>0&&Number.isFinite(progressState.copiedBytes)&&typeof progressState.phase==='string'", "Native progress/space schema missing");
        check("Native status reports real free disk space and bounded import progress fields",true);
        js("document.querySelector('.jump-links a[href=\"#conversation-panel\"]').click();true");
        waitJs("location.hash==='#conversation-panel'",5000);
        js("window.anchorBridge=null;(async()=>{const {nativeCall}=await import('https://appassets.androidplatform.net/js/voice.mjs');anchorBridge=await nativeCall('localModelStatus',{},5000);})();true");
        waitJs("window.anchorBridge!==null",10000);
        require("anchorBridge.provider==='litert'", "Same-document navigation broke trusted native bridge");
        check("In-page navigation works on Android without losing bridge identity",true);
        // Restore the same document URL (no page reload, no privileged navigation expansion).
        js("history.replaceState(null,'','https://appassets.androidplatform.net/ai.html');true");
    }
    private void checkNativeGemma() throws Exception {
        report.put("real_local_gemma_tested",false);
        js("window.nativeProof=null;(async()=>{try{const {nativeCall}=await import('https://appassets.androidplatform.net/js/voice.mjs');const cfg={model:'gemma-4-E2B-it.litertlm',provider:'litert',backend:'cpu',consent:true};const state=await nativeCall('localModelStatus',{},5000);if(!state.installed)throw Error('Real Gemma file missing');let denied=false;try{await nativeCall('aiChat',{...cfg,consent:false,messages:[{role:'user',content:'test'}]},5000);}catch(e){denied=true;}if(!denied)throw Error('Consent was not enforced');const loaded=await nativeCall('loadModel',cfg,240000);const messages=[{role:'system',content:'日本語で15文字以内の一文だけを返す。防災用品を一つ具体的に提案。思考や前置きは不要。'},{role:'user',content:'何を準備する？'}];const a=await nativeCall('aiChat',{...cfg,messages},95000);messages.push({role:'assistant',content:a.text},{role:'user',content:'他には？'});const b=await nativeCall('aiChat',{...cfg,messages},95000);if(a.reusedConversation||!b.reusedConversation)throw Error('KV history reuse condition failed');if(!a.text||!b.text||a.provider!=='litert'||b.remote!==false)throw Error('Not a local text response');window.nativeProof={ok:true,loaded,turns:[a,b],consentRejected:denied};}catch(e){window.nativeProof={ok:false,error:String(e)};}})();true");
        waitJs("window.nativeProof!==null",480000);
        require("window.nativeProof.ok", "Actual local Gemma failed: "+js("JSON.stringify(nativeProof)"));
        report.put("local_gemma",new JSONObject(new JSONArray("["+js("JSON.stringify(nativeProof)")+"]").getString(0)));
        check("Actual LiteRT-LM model load, two real replies and exact-prefix KV reuse",js("JSON.stringify(nativeProof)"));
        js("document.querySelector('#consent').checked=true;document.querySelector('#turns').value=4;document.querySelector('#speed').value=1200;document.querySelector('#goal').value='防災用品を一つずつ、日本語15文字以内の短い一文で具体的に提案。';document.querySelector('#topic').value='何を準備する？';document.querySelector('#clear').click();document.querySelector('#ai-pair').click();true");
        waitJs("document.querySelector('#status').textContent.includes('PCM仮想経路テストが終了')",420000);
        require("document.querySelector('#transcript').textContent.split('数値処理で復号').length-1===4", "Native 4-turn PCM exchange incomplete");
        check("Four on-device Gemma turns through real PCM encoding/decoding (not real-time acoustics)",js("document.querySelector('#transcript').textContent"));
        // Real model is running. Cancel it, require rejection, then wait for native work to exit.
        js("window.cancelProof=null;(async()=>{const {nativeCall}=await import('https://appassets.androidplatform.net/js/voice.mjs');const cfg={model:'gemma-4-E2B-it.litertlm',provider:'litert',backend:'cpu',consent:true,messages:[{role:'user',content:'一から百まで順に説明してください。'}]};let outcome='pending';const pending=nativeCall('aiChat',cfg,95000).then(()=>outcome='completed',()=>outcome='cancelled');await new Promise(r=>setTimeout(r,20));await nativeCall('cancelAI',{},5000);await pending;for(let i=0;i<600;i++){const s=await nativeCall('localModelStatus',{},5000);if(!s.busy){window.cancelProof={outcome,busy:s.busy};return;}await new Promise(r=>setTimeout(r,100));}window.cancelProof={error:'Native work never exited'};})().catch(e=>window.cancelProof={error:String(e)});true");
        waitJs("window.cancelProof!==null",90000);
        require("window.cancelProof.outcome==='cancelled' && window.cancelProof.busy===false", "Native cancellation failed: "+js("JSON.stringify(cancelProof)"));
        check("Actual native generation cancels; late output rejected and worker released",js("JSON.stringify(cancelProof)"));
        report.put("real_local_gemma_tested",true);
    }
    private void check(String name,Object detail)throws Exception {checks.put(new JSONObject().put("name",name).put("detail",detail));Bundle b=new Bundle();b.putString("stream","PASS: "+name+"\n");sendStatus(0,b);}
    private WebView findWeb(View view) {if(view instanceof WebView)return (WebView)view;if(view instanceof ViewGroup){ViewGroup g=(ViewGroup)view;for(int i=0;i<g.getChildCount();i++){WebView w=findWeb(g.getChildAt(i));if(w!=null)return w;}}return null;}
    private String js(String source)throws Exception {
        CountDownLatch done=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();
        runOnMainSync(() -> web.evaluateJavascript(source,s->{value.set(s);done.countDown();}));
        if(!done.await(10,TimeUnit.SECONDS))throw new AssertionError("WebView evaluateJavascript deadline");
        return value.get();
    }
    private void require(String expression,String reason)throws Exception {if(!"true".equals(js(expression)))throw new AssertionError(reason);}
    private void waitJs(String expression,long timeout)throws Exception {long end=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<end){if("true".equals(js(expression)))return;SystemClock.sleep(100);}throw new AssertionError("Timed out: "+expression+"; status="+js("document.querySelector('#status')?.textContent"));}
    private void tap(String selector)throws Exception {
        String json=js("JSON.stringify((()=>{const e=document.querySelector("+JSONObject.quote(selector)+");e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,dpr:devicePixelRatio};})())");
        JSONObject point=new JSONObject(new JSONArray("["+json+"]").getString(0));
        int[] offset=new int[2];runOnMainSync(()->web.getLocationOnScreen(offset));
        float x=offset[0]+(float)(point.getDouble("x")*point.getDouble("dpr")),y=offset[1]+(float)(point.getDouble("y")*point.getDouble("dpr"));
        long now=SystemClock.uptimeMillis();
        MotionEvent down=MotionEvent.obtain(now,now,MotionEvent.ACTION_DOWN,x,y,0),up=MotionEvent.obtain(now,now+80,MotionEvent.ACTION_UP,x,y,0);
        down.setSource(InputDevice.SOURCE_TOUCHSCREEN);up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        try{sendPointerSync(down);sendPointerSync(up);}finally{down.recycle();up.recycle();}
    }
}
