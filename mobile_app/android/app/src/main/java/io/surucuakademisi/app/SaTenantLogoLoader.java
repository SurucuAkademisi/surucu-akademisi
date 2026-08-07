package io.surucuakademisi.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;

final class SaTenantLogoLoader {

    private static final int CONNECT_TIMEOUT_MS = 5000;
    private static final int READ_TIMEOUT_MS = 8000;
    private static final int MAX_BYTES = 1024 * 1024;
    private static final int MAX_REDIRECTS = 3;
    private static final int MAX_BITMAP_DIMENSION_PX = 256;
    private static final String CACHE_DIR = "sa_tenant_logo_cache_v2";

    private SaTenantLogoLoader() {}

    static boolean isAllowedLogoUrl(String rawUrl) {
        return validateUrl(rawUrl) != null;
    }

    static String validateUrl(String rawUrl) {
        if (rawUrl == null) return null;
        String trimmed = rawUrl.trim();
        if (trimmed.isEmpty() || trimmed.length() > 2048) return null;
        try {
            URL url = new URL(trimmed);
            if (!"https".equalsIgnoreCase(url.getProtocol())) return null;
            if (url.getUserInfo() != null && !url.getUserInfo().isEmpty()) return null;
            String host = url.getHost();
            if (host == null || host.isEmpty()) return null;
            if (!isAllowedStorageHost(host) || isPrivateOrLocalHost(host)) return null;
            return url.toString();
        } catch (Exception ignored) {
            return null;
        }
    }

    private static boolean isAllowedStorageHost(String host) {
        String h = host.toLowerCase(Locale.US);
        if ("firebasestorage.googleapis.com".equals(h)) return true;
        if ("surucuakademisi-f5e1f.firebasestorage.app".equals(h)) return true;
        return h.endsWith(".firebasestorage.app");
    }

    private static boolean isPrivateOrLocalHost(String host) {
        String h = host.toLowerCase(Locale.US);
        if ("localhost".equals(h) || h.endsWith(".localhost")) return true;
        if ("::1".equals(h) || "[::1]".equals(h)) return true;
        if (!h.matches("^\\d{1,3}(\\.\\d{1,3}){3}$")) return false;
        try {
            InetAddress addr = InetAddress.getByName(h);
            return addr.isAnyLocalAddress()
                || addr.isLoopbackAddress()
                || addr.isLinkLocalAddress()
                || addr.isSiteLocalAddress();
        } catch (Exception ignored) {
            return true;
        }
    }

    static Bitmap loadBitmap(Context context, String rawUrl) {
        String safeUrl = validateUrl(rawUrl);
        if (safeUrl == null || context == null) return null;

        Bitmap cached = readCache(context, safeUrl);
        if (cached != null) return cached;

        byte[] bytes = downloadBytes(safeUrl);
        if (bytes == null || bytes.length == 0) return null;

        Bitmap decoded = decodeDownsampled(bytes);
        if (decoded != null) {
            writeCache(context, safeUrl, bytes);
        }
        return decoded;
    }

    private static byte[] downloadBytes(String safeUrl) {
        String current = safeUrl;
        for (int redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(current).openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
                connection.setReadTimeout(READ_TIMEOUT_MS);
                connection.setRequestMethod("GET");

                int code = connection.getResponseCode();
                if (code == HttpURLConnection.HTTP_MOVED_PERM
                    || code == HttpURLConnection.HTTP_MOVED_TEMP
                    || code == HttpURLConnection.HTTP_SEE_OTHER) {
                    String location = connection.getHeaderField("Location");
                    if (location == null || location.trim().isEmpty()) return null;
                    String next = validateUrl(location);
                    if (next == null) return null;
                    current = next;
                    continue;
                }
                if (code != HttpURLConnection.HTTP_OK) return null;

                String contentType = connection.getContentType();
                if (contentType != null && !contentType.toLowerCase(Locale.US).startsWith("image/")) {
                    return null;
                }

                InputStream input = connection.getInputStream();
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int total = 0;
                int read;
                while ((read = input.read(chunk)) != -1) {
                    total += read;
                    if (total > MAX_BYTES) return null;
                    buffer.write(chunk, 0, read);
                }
                input.close();
                return buffer.toByteArray();
            } catch (Exception ignored) {
                return null;
            } finally {
                if (connection != null) connection.disconnect();
            }
        }
        return null;
    }

    private static Bitmap decodeDownsampled(byte[] bytes) {
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;

            int sample = 1;
            int maxDim = Math.max(bounds.outWidth, bounds.outHeight);
            while (maxDim / sample > MAX_BITMAP_DIMENSION_PX) {
                sample *= 2;
            }

            BitmapFactory.Options decode = new BitmapFactory.Options();
            decode.inSampleSize = sample;
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, decode);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static File cacheDir(Context context) {
        File dir = new File(context.getCacheDir(), CACHE_DIR);
        if (!dir.exists() && !dir.mkdirs()) return null;
        return dir;
    }

    private static String cacheKey(String safeUrl) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(safeUrl.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : hash) {
                sb.append(String.format(Locale.US, "%02x", b));
            }
            return sb.toString();
        } catch (Exception ignored) {
            return String.valueOf(safeUrl.hashCode());
        }
    }

    private static Bitmap readCache(Context context, String safeUrl) {
        try {
            File dir = cacheDir(context);
            if (dir == null) return null;
            File file = new File(dir, cacheKey(safeUrl) + ".img");
            if (!file.exists() || file.length() == 0 || file.length() > MAX_BYTES) return null;
            FileInputStream in = new FileInputStream(file);
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = in.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
            }
            in.close();
            return decodeDownsampled(buffer.toByteArray());
        } catch (Exception ignored) {
            return null;
        }
    }

    private static void writeCache(Context context, String safeUrl, byte[] bytes) {
        try {
            File dir = cacheDir(context);
            if (dir == null || bytes == null || bytes.length == 0) return;
            File file = new File(dir, cacheKey(safeUrl) + ".img");
            FileOutputStream out = new FileOutputStream(file, false);
            out.write(bytes);
            out.close();
        } catch (Exception ignored) {
            // Cache failure must not block delivery.
        }
    }
}
