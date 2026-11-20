/* ES5-only bootstrap, so older Android WebViews show a recovery message. */
(function () {
  var supported = false;
  try {
    supported = !!(window.crypto && window.crypto.subtle && window.crypto.randomUUID && Array.prototype.at && window.CSS && CSS.supports('height','100dvh'));
  } catch (error) {}
  function message(failed) {
    var app=document.getElementById('app');
    app.innerHTML='<main style="padding:32px 24px"><h1>SafeLease SG</h1><p style="margin-top:24px;line-height:1.7">'+(failed?'The app files could not be loaded. Reinstall the APK and try again.<br>无法载入应用文件，请重新安装 APK 后重试。':'Please update Android System WebView and Chrome, then reopen SafeLease.<br>请更新 Android System WebView 与 Chrome 后重新打开 SafeLease。')+'</p><a style="display:block;margin-top:24px;padding:16px;background:#C8102E;color:white;border-radius:12px;text-decoration:none" href="https://play.google.com/store/apps/details?id=com.google.android.webview">Update WebView / 更新 WebView</a></main>';
  }
  if(!supported){message(false);return;}
  var scripts=['model.js','app.js','reference.js','vendor/gsap.min.js','motion.js'];
  function load(index){if(index>=scripts.length)return;var script=document.createElement('script');script.src=scripts[index];script.onload=function(){load(index+1);};script.onerror=function(){message(true);};document.body.appendChild(script);}
  load(0);
})();
