package com.bluestar.accontrol;

import org.json.JSONObject;

final class AcStatus {
    static final int MIN_TEMP = 16;
    static final int MAX_TEMP = 30;

    final int temperatureCelsius;
    final boolean hasTemperature;
    final boolean powerOn;
    final boolean hasPower;
    final boolean displayOn;
    final boolean hasDisplay;
    final int modeValue;
    final String modeLabel;
    final boolean hasMode;

    AcStatus(
            int temperatureCelsius,
            boolean hasTemperature,
            boolean powerOn,
            boolean hasPower,
            boolean displayOn,
            boolean hasDisplay,
            int modeValue,
            String modeLabel,
            boolean hasMode) {
        this.temperatureCelsius = clampTemperature(temperatureCelsius);
        this.hasTemperature = hasTemperature;
        this.powerOn = powerOn;
        this.hasPower = hasPower;
        this.displayOn = displayOn;
        this.hasDisplay = hasDisplay;
        this.modeValue = modeValue;
        this.modeLabel = modeLabel == null ? "" : modeLabel;
        this.hasMode = hasMode;
    }

    static AcStatus unknown() {
        return new AcStatus(24, false, false, false, false, false, 2, "", false);
    }

    static AcStatus fromApiResponse(JSONObject root) {
        JSONObject status = root.optJSONObject("status");
        if (status == null) {
            return unknown();
        }

        JSONObject state = status.optJSONObject("state");
        JSONObject summary = status.optJSONObject("summary");

        ParsedInt temperature = parseTemperature(state == null ? null : state.opt("stemp"));
        if (!temperature.isPresent && summary != null) {
            temperature = parseTemperature(summary.opt("temperatureCelsius"));
        }

        ParsedBoolean power = parseNumericFlag(state == null ? null : state.opt("pow"));
        if (!power.isPresent && summary != null) {
            power = parseOnOff(summary.optString("power", ""));
        }

        ParsedBoolean display = parseNumericFlag(state == null ? null : state.opt("display"));
        if (!display.isPresent && summary != null) {
            display = parseOnOff(summary.optString("display", ""));
        }

        ParsedMode mode = parseMode(state == null ? null : state.opt("mode"));
        if (!mode.isPresent && summary != null) {
            mode = parseMode(summary.opt("mode"));
        }

        return new AcStatus(
                temperature.value,
                temperature.isPresent,
                power.value,
                power.isPresent,
                display.value,
                display.isPresent,
                mode.value,
                mode.label,
                mode.isPresent);
    }

    static int clampTemperature(int temperatureCelsius) {
        return Math.max(MIN_TEMP, Math.min(MAX_TEMP, temperatureCelsius));
    }

    boolean isCoolMode() {
        return hasMode && (modeValue == 2 || "cool".equalsIgnoreCase(modeLabel));
    }

    boolean isAltMode() {
        return hasPower && powerOn && hasMode && !isCoolMode();
    }

    private static ParsedInt parseTemperature(Object rawValue) {
        if (rawValue == null) {
            return ParsedInt.missing(24);
        }
        if (rawValue instanceof Number) {
            return ParsedInt.present((int) Math.round(((Number) rawValue).doubleValue()));
        }
        String text = String.valueOf(rawValue).trim();
        if (text.length() == 0 || "null".equalsIgnoreCase(text)) {
            return ParsedInt.missing(24);
        }
        try {
            return ParsedInt.present((int) Math.round(Double.parseDouble(text)));
        } catch (NumberFormatException error) {
            return ParsedInt.missing(24);
        }
    }

    private static ParsedBoolean parseNumericFlag(Object rawValue) {
        if (rawValue == null) {
            return ParsedBoolean.missing(false);
        }
        if (rawValue instanceof Number) {
            int value = ((Number) rawValue).intValue();
            if (value == 0 || value == 1) {
                return ParsedBoolean.present(value == 1);
            }
        }
        String text = String.valueOf(rawValue).trim();
        if ("0".equals(text) || "1".equals(text)) {
            return ParsedBoolean.present("1".equals(text));
        }
        return ParsedBoolean.missing(false);
    }

    private static ParsedBoolean parseOnOff(String rawValue) {
        String text = rawValue == null ? "" : rawValue.trim();
        if ("on".equalsIgnoreCase(text)) {
            return ParsedBoolean.present(true);
        }
        if ("off".equalsIgnoreCase(text)) {
            return ParsedBoolean.present(false);
        }
        return ParsedBoolean.missing(false);
    }

    private static ParsedMode parseMode(Object rawValue) {
        if (rawValue == null) {
            return ParsedMode.missing();
        }
        if (rawValue instanceof Number) {
            return ParsedMode.present(((Number) rawValue).intValue(), "");
        }
        String text = String.valueOf(rawValue).trim();
        if (text.length() == 0 || "null".equalsIgnoreCase(text) || "unknown".equalsIgnoreCase(text)) {
            return ParsedMode.missing();
        }
        try {
            return ParsedMode.present(Integer.parseInt(text), "");
        } catch (NumberFormatException ignored) {
            return ParsedMode.present(modeValueForLabel(text), text);
        }
    }

    private static int modeValueForLabel(String label) {
        if ("fan".equalsIgnoreCase(label)) {
            return 0;
        }
        if ("heat".equalsIgnoreCase(label)) {
            return 1;
        }
        if ("cool".equalsIgnoreCase(label)) {
            return 2;
        }
        if ("dry".equalsIgnoreCase(label)) {
            return 3;
        }
        if ("auto".equalsIgnoreCase(label)) {
            return 4;
        }
        return -1;
    }

    private static final class ParsedInt {
        final int value;
        final boolean isPresent;

        private ParsedInt(int value, boolean isPresent) {
            this.value = clampTemperature(value);
            this.isPresent = isPresent;
        }

        static ParsedInt present(int value) {
            return new ParsedInt(value, true);
        }

        static ParsedInt missing(int fallback) {
            return new ParsedInt(fallback, false);
        }
    }

    private static final class ParsedBoolean {
        final boolean value;
        final boolean isPresent;

        private ParsedBoolean(boolean value, boolean isPresent) {
            this.value = value;
            this.isPresent = isPresent;
        }

        static ParsedBoolean present(boolean value) {
            return new ParsedBoolean(value, true);
        }

        static ParsedBoolean missing(boolean fallback) {
            return new ParsedBoolean(fallback, false);
        }
    }

    private static final class ParsedMode {
        final int value;
        final String label;
        final boolean isPresent;

        private ParsedMode(int value, String label, boolean isPresent) {
            this.value = value;
            this.label = label;
            this.isPresent = isPresent;
        }

        static ParsedMode present(int value, String label) {
            return new ParsedMode(value, label, true);
        }

        static ParsedMode missing() {
            return new ParsedMode(2, "", false);
        }
    }
}
