package sg.safelease.app;
import android.app.LocaleManager;import android.os.*;import android.content.res.Configuration;import java.util.Locale;
/** App-scoped locale only; never changes the phone's system language. */
final class AppLanguage {
 static void apply(MainActivity owner,String language){Locale locale="zh".equals(language)?Locale.SIMPLIFIED_CHINESE:Locale.ENGLISH;Locale.setDefault(locale);if(Build.VERSION.SDK_INT>=33){LocaleManager manager=owner.getSystemService(LocaleManager.class);String tags="zh".equals(language)?"zh-CN":"en";if(!manager.getApplicationLocales().toLanguageTags().equals(tags))manager.setApplicationLocales(LocaleList.forLanguageTags(tags));}else{Configuration c=new Configuration(owner.getResources().getConfiguration());c.setLocale(locale);owner.getResources().updateConfiguration(c,owner.getResources().getDisplayMetrics());}}
}
