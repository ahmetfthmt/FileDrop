package space.manus.filedrop.debug;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

@CapacitorPlugin(name = "NativeSocket")
public class NativeSocketPlugin extends Plugin {
    private final OkHttpClient client = new OkHttpClient();
    private final Map<String, WebSocket> sockets = new ConcurrentHashMap<>();

    @PluginMethod
    public void connect(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("WebSocket URL is required");
            return;
        }

        String socketId = UUID.randomUUID().toString();
        Request request = new Request.Builder().url(url).build();

        WebSocket ws = client.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(@NonNull WebSocket webSocket, @NonNull Response response) {
                JSObject payload = new JSObject();
                payload.put("socketId", socketId);
                notifyListeners("open", payload);
            }

            @Override
            public void onMessage(@NonNull WebSocket webSocket, @NonNull String text) {
                JSObject payload = new JSObject();
                payload.put("socketId", socketId);
                payload.put("data", text);
                notifyListeners("message", payload);
            }

            @Override
            public void onClosed(@NonNull WebSocket webSocket, int code, @NonNull String reason) {
                sockets.remove(socketId);
                JSObject payload = new JSObject();
                payload.put("socketId", socketId);
                payload.put("reason", reason);
                notifyListeners("close", payload);
            }

            @Override
            public void onFailure(@NonNull WebSocket webSocket, @NonNull Throwable t, @Nullable Response response) {
                sockets.remove(socketId);
                JSObject payload = new JSObject();
                payload.put("socketId", socketId);
                payload.put("reason", t.getMessage() != null ? t.getMessage() : "Socket failure");
                notifyListeners("error", payload);
            }
        });

        sockets.put(socketId, ws);
        JSObject result = new JSObject();
        result.put("socketId", socketId);
        call.resolve(result);
    }

    @PluginMethod
    public void send(PluginCall call) {
        String socketId = call.getString("socketId");
        String data = call.getString("data");
        if (socketId == null || data == null) {
            call.reject("socketId and data are required");
            return;
        }
        WebSocket ws = sockets.get(socketId);
        if (ws != null) {
            ws.send(data);
        }
        call.resolve();
    }

    @PluginMethod
    public void close(PluginCall call) {
        String socketId = call.getString("socketId");
        if (socketId != null) {
            WebSocket ws = sockets.remove(socketId);
            if (ws != null) {
                ws.close(1000, "Client closed");
            }
        }
        call.resolve();
    }
}
