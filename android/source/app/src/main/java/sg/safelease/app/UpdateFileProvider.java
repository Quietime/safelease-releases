package sg.safelease.app;
import android.content.*;import android.database.*;import android.net.Uri;import android.os.ParcelFileDescriptor;import android.provider.OpenableColumns;import java.io.*;
/** Grants the system installer read access to one verified private update file. */
public final class UpdateFileProvider extends ContentProvider {
 @Override public boolean onCreate(){return true;}
 private File file(Uri uri)throws FileNotFoundException{String name=uri.getLastPathSegment();if(uri.getPathSegments().size()!=1||name==null||!name.matches("update-v[0-9]+\\.apk"))throw new FileNotFoundException();File f=new File(new File(getContext().getFilesDir(),"updates"),name);if(!f.isFile())throw new FileNotFoundException();return f;}
 @Override public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{if(!"r".equals(mode))throw new FileNotFoundException("read_only");return ParcelFileDescriptor.open(file(uri),ParcelFileDescriptor.MODE_READ_ONLY);}
 @Override public String getType(Uri uri){return "application/vnd.android.package-archive";}
 @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort){try{File f=file(uri);MatrixCursor c=new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE});c.addRow(new Object[]{f.getName(),f.length()});return c;}catch(Exception e){return null;}}
 @Override public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException();}@Override public int update(Uri uri,ContentValues values,String s,String[] args){throw new UnsupportedOperationException();}@Override public int delete(Uri uri,String s,String[] args){throw new UnsupportedOperationException();}
}
