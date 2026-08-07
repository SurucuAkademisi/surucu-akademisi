package io.surucuakademisi.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.util.Map;

final class SaNotificationRenderer {

    static final String CHANNEL_ID = "surucu_akademisi_tenant_notifications_v2";
    private static final String DATA_PUSH_FORMAT = "pushFormat";
    private static final String DATA_NOTIFICATION_ID = "notificationId";
    private static final String DATA_TENANT_ID = "tenantId";
    private static final String DATA_TYPE = "type";
    private static final String DATA_DISPLAY_TITLE = "displayTitle";
    private static final String DATA_DISPLAY_BODY = "displayBody";
    private static final String DATA_BRAND_SOURCE = "brandSource";
    private static final String DATA_BRAND_IMAGE_URL = "brandImageUrl";
    private static final String EXTRA_GOOGLE_MESSAGE_ID = "google.message_id";

    private SaNotificationRenderer() {}

    static void showNativeV2(Context context, Map<String, String> data, String messageId) {
        if (context == null || data == null) return;
        if (!hasPostNotificationsPermission(context)) return;

        String displayTitle = sanitize(data.get(DATA_DISPLAY_TITLE), 200);
        String displayBody = sanitize(data.get(DATA_DISPLAY_BODY), 2000);
        if (displayTitle.isEmpty() && displayBody.isEmpty()) return;

        String notificationId = sanitize(data.get(DATA_NOTIFICATION_ID), 128);
        String tenantId = sanitize(data.get(DATA_TENANT_ID), 128);
        String type = sanitize(data.get(DATA_TYPE), 64);
        String brandImageUrl = data.get(DATA_BRAND_IMAGE_URL);
        String pushFormat = sanitize(data.get(DATA_PUSH_FORMAT), 32);

        int androidNotificationId = stableNotificationId(notificationId);

        ensureChannel(context);

        postNotification(
            context,
            androidNotificationId,
            displayTitle,
            displayBody,
            notificationId,
            tenantId,
            type,
            pushFormat,
            messageId,
            null
        );

        if (!SaTenantLogoLoader.isAllowedLogoUrl(brandImageUrl)) return;

        final String safeImageUrl = SaTenantLogoLoader.validateUrl(brandImageUrl);
        if (safeImageUrl == null) return;

        new Thread(
            () -> {
                try {
                    Bitmap logo = SaTenantLogoLoader.loadBitmap(context.getApplicationContext(), safeImageUrl);
                    if (logo == null) return;
                    if (!hasPostNotificationsPermission(context)) return;
                    postNotification(
                        context,
                        androidNotificationId,
                        displayTitle,
                        displayBody,
                        notificationId,
                        tenantId,
                        type,
                        pushFormat,
                        messageId,
                        logo
                    );
                } catch (Exception ignored) {
                    // Keep the original text notification.
                }
            },
            "SaTenantLogoUpdate"
        ).start();
    }

    private static void postNotification(
        Context context,
        int androidNotificationId,
        String displayTitle,
        String displayBody,
        String notificationId,
        String tenantId,
        String type,
        String pushFormat,
        String messageId,
        Bitmap largeIcon
    ) {
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(displayTitle)
            .setContentText(displayBody)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(displayBody))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setContentIntent(buildContentIntent(context, notificationId, tenantId, type, pushFormat, messageId))
            .setPriority(NotificationCompat.PRIORITY_HIGH);

        if (largeIcon != null) {
            builder.setLargeIcon(largeIcon);
        }

        NotificationManagerCompat.from(context).notify(androidNotificationId, builder.build());
    }

    private static PendingIntent buildContentIntent(
        Context context,
        String notificationId,
        String tenantId,
        String type,
        String pushFormat,
        String messageId
    ) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (!notificationId.isEmpty()) intent.putExtra(DATA_NOTIFICATION_ID, notificationId);
        if (!tenantId.isEmpty()) intent.putExtra(DATA_TENANT_ID, tenantId);
        if (!type.isEmpty()) intent.putExtra(DATA_TYPE, type);
        if (!pushFormat.isEmpty()) intent.putExtra(DATA_PUSH_FORMAT, pushFormat);
        if (messageId != null && !messageId.trim().isEmpty()) {
            intent.putExtra(EXTRA_GOOGLE_MESSAGE_ID, messageId.trim());
        }

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getActivity(context, stableNotificationId(notificationId), intent, flags);
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel existing = manager.getNotificationChannel(CHANNEL_ID);
        if (existing != null) return;

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.tenant_push_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription(context.getString(R.string.tenant_push_channel_description));
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }

    private static boolean hasPostNotificationsPermission(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true;
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED;
    }

    private static int stableNotificationId(String notificationId) {
        if (notificationId == null || notificationId.isEmpty()) return 0x5341_0001;
        return notificationId.hashCode() & 0x7fffffff;
    }

    private static String sanitize(String value, int maxLen) {
        if (value == null) return "";
        String trimmed = value.trim();
        if (trimmed.length() > maxLen) {
            return trimmed.substring(0, maxLen);
        }
        return trimmed;
    }
}
