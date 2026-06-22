package com.bluestar.accontrol;

import android.content.Context;
import android.content.SharedPreferences;

final class AcPrefs {
    private static final String PREFS_NAME = "blue_star_ac";
    private static final String KEY_BASE_URL = "base_url";
    private static final String KEY_DEVICE_ID = "device_id";
    private static final String KEY_LAST_TEMP = "last_temp";
    private static final String KEY_HAS_TEMP = "has_temp";
    private static final String KEY_POWER_ON = "power_on";
    private static final String KEY_HAS_POWER = "has_power";
    private static final String KEY_DISPLAY_ON = "display_on";
    private static final String KEY_HAS_DISPLAY = "has_display";
    private static final String KEY_MODE_VALUE = "mode_value";
    private static final String KEY_MODE_LABEL = "mode_label";
    private static final String KEY_HAS_MODE = "has_mode";
    private static final String KEY_WIDGET_THEME = "widget_theme";
    private static final String KEY_WIDGET_BACKGROUND_OPACITY = "widget_background_opacity";
    private static final String KEY_LAST_BACKGROUND_REFRESH_MS = "last_background_refresh_ms";
    private static final String KEY_LAST_ERROR = "last_error";

    static final String WIDGET_THEME_SYSTEM = "system";
    static final String WIDGET_THEME_LIGHT = "light";
    static final String WIDGET_THEME_DARK = "dark";

    private final Context context;
    private final SharedPreferences prefs;

    AcPrefs(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    String getBaseUrl() {
        return prefs.getString(KEY_BASE_URL, "");
    }

    String getDeviceId() {
        String stored = prefs.getString(KEY_DEVICE_ID, "");
        if (stored == null || stored.trim().length() == 0) {
            return context.getString(R.string.default_device_id);
        }
        return stored.trim();
    }

    boolean hasBaseUrl() {
        String baseUrl = getBaseUrl();
        return baseUrl != null && baseUrl.trim().length() > 0;
    }

    void saveConnection(String baseUrl, String deviceId) {
        String normalizedUrl = AcApiClient.normalizeBaseUrl(baseUrl);
        String normalizedDeviceId = deviceId == null ? "" : deviceId.trim();
        if (normalizedDeviceId.length() == 0) {
            normalizedDeviceId = context.getString(R.string.default_device_id);
        }
        prefs.edit()
                .putString(KEY_BASE_URL, normalizedUrl)
                .putString(KEY_DEVICE_ID, normalizedDeviceId)
                .remove(KEY_LAST_ERROR)
                .apply();
    }

    AcStatus getLastStatus() {
        return new AcStatus(
                prefs.getInt(KEY_LAST_TEMP, 24),
                prefs.getBoolean(KEY_HAS_TEMP, false),
                prefs.getBoolean(KEY_POWER_ON, false),
                prefs.getBoolean(KEY_HAS_POWER, false),
                prefs.getBoolean(KEY_DISPLAY_ON, false),
                prefs.getBoolean(KEY_HAS_DISPLAY, false),
                prefs.getInt(KEY_MODE_VALUE, 2),
                prefs.getString(KEY_MODE_LABEL, ""),
                prefs.getBoolean(KEY_HAS_MODE, false));
    }

    void saveStatus(AcStatus status) {
        prefs.edit()
                .putInt(KEY_LAST_TEMP, status.temperatureCelsius)
                .putBoolean(KEY_HAS_TEMP, status.hasTemperature)
                .putBoolean(KEY_POWER_ON, status.powerOn)
                .putBoolean(KEY_HAS_POWER, status.hasPower)
                .putBoolean(KEY_DISPLAY_ON, status.displayOn)
                .putBoolean(KEY_HAS_DISPLAY, status.hasDisplay)
                .putInt(KEY_MODE_VALUE, status.modeValue)
                .putString(KEY_MODE_LABEL, status.modeLabel)
                .putBoolean(KEY_HAS_MODE, status.hasMode)
                .remove(KEY_LAST_ERROR)
                .apply();
    }

    void saveTemperature(int temperatureCelsius) {
        prefs.edit()
                .putInt(KEY_LAST_TEMP, AcStatus.clampTemperature(temperatureCelsius))
                .putBoolean(KEY_HAS_TEMP, true)
                .apply();
    }

    void savePower(boolean powerOn) {
        prefs.edit()
                .putBoolean(KEY_POWER_ON, powerOn)
                .putBoolean(KEY_HAS_POWER, true)
                .apply();
    }

    void saveDisplay(boolean displayOn) {
        prefs.edit()
                .putBoolean(KEY_DISPLAY_ON, displayOn)
                .putBoolean(KEY_HAS_DISPLAY, true)
                .apply();
    }

    void saveCoolMode() {
        prefs.edit()
                .putBoolean(KEY_POWER_ON, true)
                .putBoolean(KEY_HAS_POWER, true)
                .putInt(KEY_MODE_VALUE, 2)
                .putString(KEY_MODE_LABEL, "Cool")
                .putBoolean(KEY_HAS_MODE, true)
                .apply();
    }

    void saveError(Exception error) {
        String message = error.getMessage();
        prefs.edit()
                .putString(KEY_LAST_ERROR, message == null ? error.getClass().getSimpleName() : message)
                .apply();
    }

    String getLastError() {
        return prefs.getString(KEY_LAST_ERROR, "");
    }

    boolean canRunBackgroundRefresh(long nowMs, long minIntervalMs) {
        long lastRefreshMs = prefs.getLong(KEY_LAST_BACKGROUND_REFRESH_MS, 0L);
        return lastRefreshMs <= 0L || nowMs - lastRefreshMs >= minIntervalMs;
    }

    void markBackgroundRefresh(long nowMs) {
        prefs.edit()
                .putLong(KEY_LAST_BACKGROUND_REFRESH_MS, nowMs)
                .apply();
    }

    String getWidgetTheme() {
        String theme = prefs.getString(KEY_WIDGET_THEME, WIDGET_THEME_SYSTEM);
        if (WIDGET_THEME_LIGHT.equals(theme) || WIDGET_THEME_DARK.equals(theme)) {
            return theme;
        }
        return WIDGET_THEME_SYSTEM;
    }

    void saveWidgetTheme(String theme) {
        String normalized = WIDGET_THEME_LIGHT.equals(theme) || WIDGET_THEME_DARK.equals(theme)
                ? theme
                : WIDGET_THEME_SYSTEM;
        prefs.edit()
                .putString(KEY_WIDGET_THEME, normalized)
                .apply();
    }

    int getWidgetBackgroundOpacity() {
        return clampPercent(prefs.getInt(KEY_WIDGET_BACKGROUND_OPACITY, 0));
    }

    void saveWidgetBackgroundOpacity(int opacityPercent) {
        prefs.edit()
                .putInt(KEY_WIDGET_BACKGROUND_OPACITY, clampPercent(opacityPercent))
                .apply();
    }

    private static int clampPercent(int value) {
        return Math.max(0, Math.min(100, value));
    }
}
