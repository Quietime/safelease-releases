package sg.safelease.app;
import android.app.*;import android.os.Bundle;import java.io.*;import java.net.URL;import org.json.*;
/** Instrumented policy checks run on actual Android classes, not a stub PackageManager. */
public class UpdateChecks extends Instrumentation {
 JSONArray results=new JSONArray();interface Check {void run()throws Exception;}
 void pass(String name,Check check)throws Exception{check.run();results.put(new JSONObject().put("name",name).put("pass",true));}
 void rejected(Check check)throws Exception{boolean denied=false;try{check.run();}catch(SecurityException e){denied=true;}if(!denied)throw new AssertionError("Expected rejection");}
 @Override public void onCreate(Bundle args){super.onCreate(args);start();}
 @Override public void onStart(){Bundle output=new Bundle();File fixture=new File(getTargetContext().getCacheDir(),"updater-policy-fixture.apk");try{
  try(InputStream in=getContext().getAssets().open("release-fixture.apk");FileOutputStream out=new FileOutputStream(fixture)){byte[] bytes=new byte[32768];int n;while((n=in.read(bytes))!=-1)out.write(bytes,0,n);}
  byte[] all;try(InputStream in=new FileInputStream(fixture)){all=AppUpdater.read(in,(int)AppUpdater.MAX_BYTES);}String hash=AppUpdater.digest(all),certificate="772db9f5b824692fc43c7b23cacb1c3f79002c57bed41160c938849b84c1b16a";
  JSONObject valid=new JSONObject().put("schema",1).put("packageName","sg.safelease.presentation").put("versionCode",14000).put("versionName","1.4.0").put("sha256",hash).put("size",fixture.length()).put("minSdk",28).put("downloadUrl","https://github.com/Quietime/safelease-releases/releases/download/v1.4.0/SafeLease-SG-1.4.0.apk");
  pass("Valid release metadata accepted",()->AppUpdater.validateMetadata(valid,"sg.safelease.presentation",35));
  pass("HTTP update URL rejected",()->rejected(()->AppUpdater.validateUrl(new URL("http://github.com/Quietime/safelease-releases/releases/download/v1/a.apk"))));
  pass("Untrusted HTTPS host rejected",()->rejected(()->AppUpdater.validateUrl(new URL("https://attacker.invalid/a.apk"))));
  pass("Wrong package metadata rejected",()->rejected(()->AppUpdater.validateMetadata(valid,"other.package",35)));
  pass("Unsupported device SDK rejected",()->rejected(()->AppUpdater.validateMetadata(valid,"sg.safelease.presentation",27)));
  pass("Actual release APK checksum, package, version and signer accepted",()->AppUpdater.verifyArchive(getTargetContext(),fixture,"sg.safelease.presentation",14000,hash,certificate));
  pass("Changed checksum rejected",()->rejected(()->AppUpdater.verifyArchive(getTargetContext(),fixture,"sg.safelease.presentation",14000,"0".repeat(64),certificate)));
  pass("Different APK package rejected",()->rejected(()->AppUpdater.verifyArchive(getTargetContext(),fixture,"other.package",14000,hash,certificate)));
  pass("Different version rejected",()->rejected(()->AppUpdater.verifyArchive(getTargetContext(),fixture,"sg.safelease.presentation",11999,hash,certificate)));
  pass("Different signing certificate rejected",()->rejected(()->AppUpdater.verifyArchive(getTargetContext(),fixture,"sg.safelease.presentation",14000,hash,"0".repeat(64))));
  output.putString("stream","10 updater policy checks passed\n");output.putString("results",results.toString());
  try(FileOutputStream out=new FileOutputStream(new File(getTargetContext().getFilesDir(),"updater-policy-results.json"))){out.write(new JSONObject().put("checks",results).toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));}
  finish(Activity.RESULT_OK,output);
 }catch(Throwable error){output.putString("stream",error.toString());finish(Activity.RESULT_CANCELED,output);}finally{fixture.delete();}}
}
