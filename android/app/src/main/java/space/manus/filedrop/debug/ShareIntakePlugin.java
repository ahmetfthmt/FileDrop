package space.manus.filedrop.debug;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "ShareIntake")
public class ShareIntakePlugin extends Plugin {
    private static final List<JSObject> pendingFiles = new ArrayList<>();
    private static ShareIntakePlugin activeInstance = null;

    @Override
    public void load() {
        activeInstance = this;
    }

    @PluginMethod
    public void getPendingSharedFiles(PluginCall call) {
        JSArray arr = new JSArray();
        synchronized (pendingFiles) {
            for (JSObject item : pendingFiles) {
                arr.put(item);
            }
            pendingFiles.clear();
        }
        JSObject result = new JSObject();
        result.put("files", arr);
        call.resolve(result);
    }

    public static void ingestIntent(Context context, Intent intent) {
        String action = intent.getAction();
        List<JSObject> collected = new ArrayList<>();

        if (Intent.ACTION_SEND.equals(action)) {
            Uri streamUri = getParcelableExtraCompat(intent, Intent.EXTRA_STREAM, Uri.class);
            if (streamUri != null) {
                JSObject fileObj = readUriToJSObject(context, streamUri);
                if (fileObj != null) collected.add(fileObj);
            } else {
                String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
                if (sharedText != null && !sharedText.isEmpty()) {
                    JSObject textObj = new JSObject();
                    textObj.put("name", "paylasilan-metin.txt");
                    textObj.put("mimeType", "text/plain");
                    textObj.put(
                        "dataBase64",
                        Base64.encodeToString(sharedText.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP)
                    );
                    collected.add(textObj);
                }
            }
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> uris = getParcelableArrayListExtraCompat(intent, Intent.EXTRA_STREAM, Uri.class);
            if (uris != null) {
                for (Uri uri : uris) {
                    JSObject fileObj = readUriToJSObject(context, uri);
                    if (fileObj != null) collected.add(fileObj);
                }
            }
        }

        if (collected.isEmpty()) return;

        if (activeInstance != null) {
            JSArray arr = new JSArray();
            for (JSObject item : collected) {
                arr.put(item);
            }
            JSObject eventPayload = new JSObject();
            eventPayload.put("files", arr);
            activeInstance.notifyListeners("sharedFilesReceived", eventPayload);
        } else {
            synchronized (pendingFiles) {
                pendingFiles.addAll(collected);
            }
        }
    }

    @SuppressWarnings("deprecation")
    private static <T> T getParcelableExtraCompat(Intent intent, String key, Class<T> clazz) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(key, clazz);
        }
        Object obj = intent.getParcelableExtra(key);
        return clazz.isInstance(obj) ? clazz.cast(obj) : null;
    }

    @SuppressWarnings({"deprecation", "unchecked"})
    private static <T> ArrayList<T> getParcelableArrayListExtraCompat(
        Intent intent, String key, Class<T> clazz
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableArrayListExtra(key, clazz);
        }
        return intent.getParcelableArrayListExtra(key);
    }

    private static JSObject readUriToJSObject(Context context, Uri uri) {
        ContentResolver resolver = context.getContentResolver();
        String name = resolveDisplayName(resolver, uri);
        String mimeType = resolver.getType(uri);
        if (mimeType == null || mimeType.isEmpty()) {
            mimeType = "application/octet-stream";
        }

        try (InputStream is = resolver.openInputStream(uri)) {
            if (is == null) return null;
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[16384];
            int nRead;
            while ((nRead = is.read(chunk, 0, chunk.length)) != -1) {
                buffer.write(chunk, 0, nRead);
            }
            JSObject obj = new JSObject();
            obj.put("name", name);
            obj.put("mimeType", mimeType);
            obj.put("dataBase64", Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP));
            return obj;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String resolveDisplayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String val = cursor.getString(idx);
                    if (val != null && !val.isEmpty()) return val;
                }
            }
        } catch (Exception ignored) {
            // Fall back to URI last path segment
        }
        String last = uri.getLastPathSegment();
        return last != null && !last.isEmpty() ? last : "paylasilan-dosya";
    }
}
