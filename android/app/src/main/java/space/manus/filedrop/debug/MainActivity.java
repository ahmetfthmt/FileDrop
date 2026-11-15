package space.manus.filedrop.debug;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeSocketPlugin.class);
        registerPlugin(ShareIntakePlugin.class);
        super.onCreate(savedInstanceState);
        handleShareIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShareIntent(intent);
    }

    private void handleShareIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ShareIntakePlugin.ingestIntent(this, intent);
        }
    }
}
