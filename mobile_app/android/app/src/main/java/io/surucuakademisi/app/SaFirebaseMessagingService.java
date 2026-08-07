package io.surucuakademisi.app;

import android.util.Log;
import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class SaFirebaseMessagingService extends FirebaseMessagingService {

    private static final String TAG = "SaFcmService";
    private static final String DATA_PUSH_FORMAT = "pushFormat";
    private static final String DATA_DISPLAY_TITLE = "displayTitle";
    private static final String DATA_DISPLAY_BODY = "displayBody";
    private static final String NATIVE_V2_FORMAT = "native_v2";

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        PushNotificationsPlugin.onNewToken(token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        if (isNativeV2Message(remoteMessage)) {
            Map<String, String> data = remoteMessage.getData();
            SaNotificationRenderer.showNativeV2(getApplicationContext(), data, remoteMessage.getMessageId());
            return;
        }

        if (remoteMessage.getNotification() != null) {
            // Legacy notification + data: system tray in background/terminated; Capacitor for foreground.
            PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
            return;
        }

        Log.d(TAG, "ignored_data_only_without_native_v2");
        PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
    }

    private static boolean isNativeV2Message(RemoteMessage remoteMessage) {
        if (remoteMessage == null || remoteMessage.getNotification() != null) return false;
        Map<String, String> data = remoteMessage.getData();
        if (data == null || data.isEmpty()) return false;
        String pushFormat = data.get(DATA_PUSH_FORMAT);
        if (pushFormat == null || !NATIVE_V2_FORMAT.equals(pushFormat.trim())) return false;
        String title = data.get(DATA_DISPLAY_TITLE);
        String body = data.get(DATA_DISPLAY_BODY);
        return title != null && !title.trim().isEmpty() && body != null && !body.trim().isEmpty();
    }
}
