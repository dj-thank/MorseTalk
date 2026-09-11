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
            String model=arguments==null?"":arguments.getString("model","");
            if(!model.isEmpty()) {
                js("document.querySelector('#model').value="+JSONObject.quote(model)+";document.querySelector('#consent').checked=true;document.querySelector('#test-ai').click();true");
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
