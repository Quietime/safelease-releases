package sg.safelease.app;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.UUID;
import org.json.JSONObject;

/** Read-only public data installation. A partial copy never becomes an accepted database. */
final class ReferenceStore {
 private static String digest(File file)throws Exception {
  MessageDigest hash=MessageDigest.getInstance("SHA-256");
  try(InputStream in=new FileInputStream(file)){byte[] bytes=new byte[32768];int n;while((n=in.read(bytes))!=-1)hash.update(bytes,0,n);}
  StringBuilder out=new StringBuilder();for(byte b:hash.digest())out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();
 }
 static SQLiteDatabase open(Context context)throws Exception {
  String expected;
  try(InputStream in=context.getAssets().open("reference/catalog.json")){ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[16384];int n;while((n=in.read(buffer))!=-1)bytes.write(buffer,0,n);expected=new JSONObject(bytes.toString("UTF-8")).getString("sha256_db");}
  File target=new File(context.getFilesDir(),"reference.db");
  if(!target.isFile()||!expected.equals(digest(target))){
   File temp=new File(context.getFilesDir(),"reference-install-"+UUID.randomUUID()+".tmp");
   try{
    try(InputStream in=context.getAssets().open("reference/reference.db");FileOutputStream out=new FileOutputStream(temp)){byte[] bytes=new byte[32768];int n;while((n=in.read(bytes))!=-1)out.write(bytes,0,n);out.getFD().sync();}
    if(!expected.equals(digest(temp)))throw new IOException("Reference integrity check failed");
    Files.move(temp.toPath(),target.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
   }finally{if(temp.exists()&&!temp.delete())temp.deleteOnExit();}
  }
  return SQLiteDatabase.openDatabase(target.getPath(),null,SQLiteDatabase.OPEN_READONLY);
 }
}
