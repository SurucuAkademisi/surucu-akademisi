package io.surucuakademisi.app;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

/**
 * Read-only Android navigation-bar inset → CSS --android-nav-inset-bottom.
 * Does NOT install OnApplyWindowInsetsListener (preserves default WebView inset handling).
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        scheduleAndroidNavInsetRead();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            scheduleAndroidNavInsetRead();
        }
    }

    private void scheduleAndroidNavInsetRead() {
        Bridge bridge = getBridge();
        if (bridge == null) {
            return;
        }
        WebView webView = bridge.getWebView();
        if (webView == null) {
            return;
        }
        webView.post(this::injectAndroidNavInsetBottomReadOnly);
    }

    private void injectAndroidNavInsetBottomReadOnly() {
        Bridge bridge = getBridge();
        if (bridge == null) {
            return;
        }
        WebView webView = bridge.getWebView();
        if (webView == null) {
            return;
        }

        WindowInsetsCompat rootInsets = ViewCompat.getRootWindowInsets(webView);
        if (rootInsets == null) {
            return;
        }

        Insets navInsets = rootInsets.getInsets(WindowInsetsCompat.Type.navigationBars());
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0f) {
            density = 1f;
        }
        int cssPx = Math.round(navInsets.bottom / density);
        if (cssPx < 0) {
            cssPx = 0;
        }

        String cssValue = cssPx + "px";
        String safe = cssValue.replace("\\", "\\\\").replace("'", "\\'");
        webView.evaluateJavascript(
            "document.documentElement.style.setProperty('--android-nav-inset-bottom','"
                + safe
                + "');",
            null
        );
    }
}
