package com.bluestar.accontrol;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.widget.RemoteViews;

public class AcWidgetProvider extends AppWidgetProvider {
    private static final long BACKGROUND_REFRESH_MIN_INTERVAL_MS = 45L * 60L * 1000L;

    static final String ACTION_TEMP_UP = "com.bluestar.accontrol.widget.TEMP_UP";
    static final String ACTION_TEMP_DOWN = "com.bluestar.accontrol.widget.TEMP_DOWN";
    static final String ACTION_POWER_TOGGLE = "com.bluestar.accontrol.widget.POWER_TOGGLE";
    static final String ACTION_DISPLAY_TOGGLE = "com.bluestar.accontrol.widget.DISPLAY_TOGGLE";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            renderWidget(context, appWidgetManager, appWidgetId);
        }
        refreshIfDueAsync(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent == null ? "" : intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)) {
            Context appContext = context.getApplicationContext();
            updateAllWidgets(appContext);
            refreshIfDueAsync(appContext);
            return;
        }
        if (ACTION_TEMP_UP.equals(action)
                || ACTION_TEMP_DOWN.equals(action)
                || ACTION_POWER_TOGGLE.equals(action)
                || ACTION_DISPLAY_TOGGLE.equals(action)) {
            handleAction(context.getApplicationContext(), action);
        }
    }

    static void updateAllWidgets(Context context) {
        Context appContext = context.getApplicationContext();
        AppWidgetManager manager = AppWidgetManager.getInstance(appContext);
        ComponentName widgetName = new ComponentName(appContext, AcWidgetProvider.class);
        int[] appWidgetIds = manager.getAppWidgetIds(widgetName);
        for (int appWidgetId : appWidgetIds) {
            renderWidget(appContext, manager, appWidgetId);
        }
    }

    private static boolean hasInstalledWidgets(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName widgetName = new ComponentName(context, AcWidgetProvider.class);
        return manager.getAppWidgetIds(widgetName).length > 0;
    }

    private static void renderWidget(Context context, AppWidgetManager manager, int appWidgetId) {
        AcPrefs prefs = new AcPrefs(context);
        AcStatus status = prefs.getLastStatus();
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_ac_control);

        if (!prefs.hasBaseUrl()) {
            views.setTextViewText(R.id.widget_main_state, "Set URL");
            views.setTextViewText(R.id.widget_display_state, "Open");
            PendingIntent openApp = openAppIntent(context);
            views.setOnClickPendingIntent(R.id.widget_root, openApp);
            views.setOnClickPendingIntent(R.id.widget_center_tap, openApp);
            views.setOnClickPendingIntent(R.id.widget_display_state, openApp);
            manager.updateAppWidget(appWidgetId, views);
            return;
        }

        String error = prefs.getLastError();
        if (error != null && error.length() > 0) {
            views.setTextViewText(R.id.widget_main_state, "Error");
        } else {
            views.setTextViewText(R.id.widget_main_state, primaryStateText(status));
        }
        views.setTextViewText(R.id.widget_display_state, displayStateText(status));

        styleMainState(views, status);
        styleDisplayState(views, status);

        views.setOnClickPendingIntent(R.id.widget_root, openAppIntent(context));
        views.setOnClickPendingIntent(R.id.widget_zone_up, broadcastIntent(context, ACTION_TEMP_UP));
        views.setOnClickPendingIntent(R.id.widget_zone_down, broadcastIntent(context, ACTION_TEMP_DOWN));
        views.setOnClickPendingIntent(R.id.widget_center_tap, broadcastIntent(context, ACTION_POWER_TOGGLE));
        views.setOnClickPendingIntent(R.id.widget_display_state, broadcastIntent(context, ACTION_DISPLAY_TOGGLE));
        manager.updateAppWidget(appWidgetId, views);
    }

    private static String primaryStateText(AcStatus status) {
        if (!status.hasPower) {
            return "--";
        }
        if (!status.powerOn) {
            return "Off";
        }
        if (status.isAltMode()) {
            return "Alt\nMode";
        }
        return String.valueOf(status.temperatureCelsius);
    }

    private static String displayStateText(AcStatus status) {
        if (status.hasPower && !status.powerOn) {
            return "";
        }
        if (!status.hasDisplay) {
            return "--";
        }
        return status.displayOn ? "On" : "Off";
    }

    private static void styleMainState(RemoteViews views, AcStatus status) {
        int color = status.isAltMode() ? Color.rgb(137, 85, 0) : Color.rgb(22, 32, 42);
        if (status.hasPower && !status.powerOn) {
            color = Color.rgb(95, 108, 123);
        }
        views.setTextColor(R.id.widget_main_state, color);
    }

    private static void styleDisplayState(RemoteViews views, AcStatus status) {
        int color = status.hasDisplay && status.displayOn ? Color.rgb(22, 32, 42) : Color.rgb(95, 108, 123);
        views.setTextColor(R.id.widget_display_state, color);
    }

    private static PendingIntent broadcastIntent(Context context, String action) {
        Intent intent = new Intent(context, AcWidgetProvider.class);
        intent.setAction(action);
        return PendingIntent.getBroadcast(
                context,
                action.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent openAppIntent(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        return PendingIntent.getActivity(
                context,
                1001,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void handleAction(final Context context, final String action) {
        final AcPrefs prefs = new AcPrefs(context);
        if (!prefs.hasBaseUrl()) {
            updateAllWidgets(context);
            return;
        }

        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    AcStatus cached = prefs.getLastStatus();
                    AcApiClient client = new AcApiClient(prefs.getBaseUrl(), prefs.getDeviceId());

                    if (ACTION_TEMP_UP.equals(action) || ACTION_TEMP_DOWN.equals(action)) {
                        int delta = ACTION_TEMP_UP.equals(action) ? 1 : -1;
                        int nextTemp = AcStatus.clampTemperature(cached.temperatureCelsius + delta);
                        if (!cached.powerOn || cached.isAltMode()) {
                            prefs.saveCoolMode();
                            prefs.saveTemperature(nextTemp);
                            updateAllWidgets(context);
                            client.sendCommand("turnOn", null);
                            client.sendCommand("setMode", 2);
                        } else {
                            prefs.saveTemperature(nextTemp);
                            updateAllWidgets(context);
                        }
                        client.sendCommand("setTemperature", nextTemp);
                    } else if (ACTION_POWER_TOGGLE.equals(action)) {
                        boolean nextPower = !cached.powerOn;
                        prefs.savePower(nextPower);
                        updateAllWidgets(context);
                        client.sendCommand(nextPower ? "turnOn" : "turnOff", null);
                        if (nextPower) {
                            client.sendCommand("setMode", 2);
                            prefs.saveCoolMode();
                        }
                    } else if (ACTION_DISPLAY_TOGGLE.equals(action)) {
                        boolean nextDisplay = !cached.displayOn;
                        prefs.saveDisplay(nextDisplay);
                        updateAllWidgets(context);
                        client.sendCommand("setDisplay", nextDisplay ? 1 : 0);
                    }

                    prefs.saveStatus(client.fetchStatus());
                } catch (Exception error) {
                    prefs.saveError(error);
                }
                updateAllWidgets(context);
            }
        }, "BlueStarAcWidgetAction").start();
    }

    private static void refreshIfDueAsync(final Context context) {
        final AcPrefs prefs = new AcPrefs(context);
        long nowMs = System.currentTimeMillis();
        if (!hasInstalledWidgets(context) || !prefs.hasBaseUrl()) {
            updateAllWidgets(context);
            return;
        }
        if (!prefs.canRunBackgroundRefresh(nowMs, BACKGROUND_REFRESH_MIN_INTERVAL_MS)) {
            updateAllWidgets(context);
            return;
        }
        prefs.markBackgroundRefresh(nowMs);
        refreshStatusAsync(context, prefs);
    }

    private static void refreshStatusAsync(final Context context, final AcPrefs prefs) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    AcApiClient client = new AcApiClient(prefs.getBaseUrl(), prefs.getDeviceId());
                    prefs.saveStatus(client.fetchStatus());
                } catch (Exception error) {
                    prefs.saveError(error);
                }
                updateAllWidgets(context);
            }
        }, "BlueStarAcWidgetRefresh").start();
    }
}
