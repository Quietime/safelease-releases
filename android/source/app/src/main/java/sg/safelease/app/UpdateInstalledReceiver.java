package sg.safelease.app;
import android.content.*;import java.io.File;import org.json.JSONObject;
/** System-delivered own-package replacement: cleanup does not depend on reopening the app. */
public final class UpdateInstalledReceiver extends BroadcastReceiver {
 @Override public void onReceive(Context context,Intent intent){if(!Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction()))return;try{
  android.content.SharedPreferences prefs=context.getSharedPreferences("updates",0);String stored=prefs.getString("download_meta",null);if(stored==null)return;
  JSONObject metadata=new JSONObject(stored);long installed=context.getPackageManager().getPackageInfo(context.getPackageName(),0).getLongVersionCode();
  if(!context.getPackageName().equals(metadata.getString("packageName"))||installed<metadata.getLong("versionCode"))return;
  File apk=new File(new File(context.getFilesDir(),"updates"),"update-v"+metadata.getLong("versionCode")+".apk");boolean existed=apk.exists(),removed=!existed||apk.delete();
  if(removed){prefs.edit().remove("download_meta").remove("auto_offered").putLong("installed_update",installed).putBoolean("package_removed",true).commit();android.util.Log.i("SafeLeaseUpdate","cleanup_receiver version="+installed+" existed="+existed+" removed="+removed);}
 }catch(Exception e){android.util.Log.w("SafeLeaseUpdate","cleanup_deferred: "+e.getClass().getSimpleName());}}
}
