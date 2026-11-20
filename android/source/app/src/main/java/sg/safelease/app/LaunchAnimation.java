package sg.safelease.app;
import android.graphics.Color;import android.os.*;import android.view.*;import android.widget.*;
/** A 1000ms in-app opening animation; no network or artificial loading wait. */
final class LaunchAnimation {
 static void show(MainActivity activity,FrameLayout container,Runnable finished){
  FrameLayout cover=new FrameLayout(activity);cover.setBackgroundColor(Color.WHITE);cover.setContentDescription("SafeLease SG");
  LinearLayout logo=new LinearLayout(activity);logo.setOrientation(LinearLayout.VERTICAL);logo.setGravity(Gravity.CENTER);
  ImageView mark=new ImageView(activity);mark.setImageResource(R.drawable.ic_launcher);int size=(int)(88*activity.getResources().getDisplayMetrics().density);logo.addView(mark,new LinearLayout.LayoutParams(size,size));
  TextView name=new TextView(activity);name.setText("SafeLease SG");name.setTextColor(Color.rgb(200,16,46));name.setTextSize(24);name.setTypeface(null,android.graphics.Typeface.BOLD);LinearLayout.LayoutParams title=new LinearLayout.LayoutParams(-2,-2);title.topMargin=(int)(18*activity.getResources().getDisplayMetrics().density);logo.addView(name,title);
  FrameLayout.LayoutParams layout=new FrameLayout.LayoutParams(-2,-2,Gravity.CENTER);cover.addView(logo,layout);container.addView(cover,new FrameLayout.LayoutParams(-1,-1));
  long start=SystemClock.uptimeMillis();logo.setAlpha(0f);logo.setScaleX(.90f);logo.setScaleY(.90f);logo.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(520).start();
  Handler timer=new Handler(Looper.getMainLooper());timer.postDelayed(()->cover.animate().alpha(0f).setDuration(120).start(),880);
  timer.postDelayed(()->{container.removeView(cover);android.util.Log.i("SafeLeaseSplash","duration_ms="+(SystemClock.uptimeMillis()-start));if(!activity.isFinishing()&&!activity.isDestroyed())finished.run();},1000);
 }
}
