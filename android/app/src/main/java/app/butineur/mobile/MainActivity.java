package app.butineur.mobile;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must come before super.onCreate: the bridge instantiates plugins on start.
        registerPlugin(WidgetBridge.class);
        super.onCreate(savedInstanceState);
        closePanelsOnBack();
    }

    /**
     * Capacitor 8 does nothing with the "back" button: the activity finishes, and
     * a panel open in the WebView used to close by quitting the app.
     *
     * We ask the web side whether it has something to close rather than infer it
     * from `WebView.canGoBack()`, which ignores the history entries created by
     * `pushState` in this setup. The web side knows which panels are open, so it
     * is the one that answers.
     */
    private void closePanelsOnBack() {
        OnBackPressedCallback callback = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView == null) {
                    quit(this);
                    return;
                }
                webView.evaluateJavascript(
                    "(window.butineurBack && window.butineurBack()) === true",
                    value -> {
                        if (!"true".equals(value)) quit(this);
                    }
                );
            }
        };
        getOnBackPressedDispatcher().addCallback(this, callback);
    }

    /** Nothing to close: hand back to the system behaviour. */
    private void quit(OnBackPressedCallback callback) {
        callback.setEnabled(false);
        getOnBackPressedDispatcher().onBackPressed();
        callback.setEnabled(true);
    }
}
