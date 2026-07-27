package app.butineur.mobile;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Doit précéder super.onCreate : le bridge instancie les plugins au démarrage.
        registerPlugin(WidgetBridge.class);
        super.onCreate(savedInstanceState);
        closePanelsOnBack();
    }

    /**
     * Capacitor 8 ne fait rien du bouton « retour » : l'activité se termine, et
     * un panneau ouvert dans la WebView se refermait en quittant l'appli.
     *
     * On demande au web s'il a quelque chose à fermer plutôt que de le déduire
     * de `WebView.canGoBack()`, qui ignore les entrées d'historique créées par
     * `pushState` dans ce montage. Le web sait quels panneaux sont ouverts,
     * c'est donc lui qui répond.
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

    /** Rien à fermer : on rend la main au comportement système. */
    private void quit(OnBackPressedCallback callback) {
        callback.setEnabled(false);
        getOnBackPressedDispatcher().onBackPressed();
        callback.setEnabled(true);
    }
}
