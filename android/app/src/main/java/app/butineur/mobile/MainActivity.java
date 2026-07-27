package app.butineur.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Doit précéder super.onCreate : le bridge instancie les plugins au démarrage.
        registerPlugin(WidgetBridge.class);
        super.onCreate(savedInstanceState);
    }
}
