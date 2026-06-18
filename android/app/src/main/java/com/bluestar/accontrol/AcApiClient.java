package com.bluestar.accontrol;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

final class AcApiClient {
    private static final int CONNECT_TIMEOUT_MS = 6000;
    private static final int READ_TIMEOUT_MS = 15000;

    private final String baseUrl;
    private final String deviceId;

    AcApiClient(String baseUrl, String deviceId) {
        this.baseUrl = normalizeBaseUrl(baseUrl);
        this.deviceId = deviceId == null ? "" : deviceId.trim();
    }

    static String normalizeBaseUrl(String rawBaseUrl) {
        String value = rawBaseUrl == null ? "" : rawBaseUrl.trim();
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        if (value.length() == 0) {
            return "";
        }
        if (!value.startsWith("http://") && !value.startsWith("https://")) {
            return "http://" + value;
        }
        return value;
    }

    AcStatus fetchStatus() throws IOException, JSONException {
        JSONObject response = requestJson("GET", devicePath("/status"), null);
        return AcStatus.fromApiResponse(response);
    }

    void sendCommand(String command, Object value) throws IOException, JSONException {
        JSONObject body = new JSONObject();
        body.put("command", command);
        if (value != null) {
            body.put("value", value);
        }
        requestJson("POST", devicePath("/commands"), body);
    }

    private String devicePath(String suffix) {
        return "/api/devices/" + encodePathSegment(deviceId) + suffix;
    }

    private JSONObject requestJson(String method, String path, JSONObject body) throws IOException, JSONException {
        if (baseUrl.length() == 0) {
            throw new IOException("Set the AC service URL first.");
        }
        if (deviceId.length() == 0) {
            throw new IOException("Set the AC device id first.");
        }

        URL url = new URL(baseUrl + path);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestMethod(method);
        connection.setRequestProperty("Accept", "application/json");

        if (body != null) {
            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setFixedLengthStreamingMode(payload.length);
            OutputStream output = connection.getOutputStream();
            try {
                output.write(payload);
            } finally {
                output.close();
            }
        }

        int statusCode = connection.getResponseCode();
        InputStream stream = statusCode >= 400 ? connection.getErrorStream() : connection.getInputStream();
        String responseText = readFully(stream);
        connection.disconnect();

        if (statusCode >= 400) {
            throw new IOException("HTTP " + statusCode + ": " + responseText);
        }
        if (responseText.trim().length() == 0) {
            return new JSONObject();
        }
        return new JSONObject(responseText);
    }

    private static String readFully(InputStream stream) throws IOException {
        if (stream == null) {
            return "";
        }
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
        StringBuilder builder = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            if (builder.length() > 0) {
                builder.append('\n');
            }
            builder.append(line);
        }
        reader.close();
        return builder.toString();
    }

    private static String encodePathSegment(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8").replace("+", "%20");
        } catch (IOException error) {
            return value;
        }
    }
}
