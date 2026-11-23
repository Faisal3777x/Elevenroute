package com.capcom.zombiecafeandroid;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.os.Build;
import android.telephony.TelephonyManager;

/**
 * Stand-ins for the few platform calls that broke once the game targets
 * Android 7.0 (API 24), the oldest target Android 15 and later will install.
 * patch.mjs points the game's own calls at these.
 */
public final class ZcrCompat {
    private ZcrCompat() {}

    /**
     * getDeviceId() needs READ_PHONE_STATE, a runtime permission from API 23 on
     * that the game never asks for, so it would throw. Return null instead,
     * which is what Android 10 and later return to apps anyway, so the game's
     * device ID (and the save it keys on the server) stays the same.
     */
    public static String getDeviceId(TelephonyManager tm) {
        try {
            return tm.getDeviceId();
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** Same as getDeviceId(): needs READ_PHONE_STATE. */
    public static String getSimSerialNumber(TelephonyManager tm) {
        try {
            return tm.getSimSerialNumber();
        } catch (RuntimeException e) {
            return null;
        }
    }

    /**
     * Notification.setLatestEventInfo() was removed in Android 6.0, so every
     * cafe reminder threw NoSuchMethodError. Build the same notification with
     * Notification.Builder and return it; callers use the returned one.
     */
    public static Notification setLatestEventInfo(Notification n, Context context,
            CharSequence title, CharSequence text, PendingIntent intent) {
        if (Build.VERSION.SDK_INT < 16) {
            try {
                Notification.class
                        .getMethod("setLatestEventInfo", Context.class, CharSequence.class,
                                CharSequence.class, PendingIntent.class)
                        .invoke(n, context, title, text, intent);
            } catch (Exception ignored) {
                // Very old Android: leave the notification as it was.
            }
            return n;
        }
        Notification.Builder b = new Notification.Builder(context)
                .setSmallIcon(n.icon)
                .setWhen(n.when)
                .setTicker(n.tickerText)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(intent)
                .setDefaults(n.defaults)
                .setAutoCancel((n.flags & Notification.FLAG_AUTO_CANCEL) != 0);
        if (n.sound != null) {
            b.setSound(n.sound, n.audioStreamType);
        }
        return b.build();
    }
}
