package com.bluestar.accontrol;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.EditText;
import android.widget.NumberPicker;
import android.widget.Switch;
import android.widget.TextView;

public class MainActivity extends Activity {
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private AcPrefs prefs;
    private View connectionPanel;
    private EditText baseUrlInput;
    private EditText deviceIdInput;
    private TextView statusText;
    private TextView powerState;
    private NumberPicker tempPicker;
    private Switch displaySwitch;
    private Button powerButton;
    private boolean ignoreDisplayChange;
    private boolean ignoreTempChange;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        prefs = new AcPrefs(this);
        connectionPanel = findViewById(R.id.connection_panel);
        baseUrlInput = findViewById(R.id.base_url_input);
        deviceIdInput = findViewById(R.id.device_id_input);
        statusText = findViewById(R.id.status_text);
        powerState = findViewById(R.id.power_state);
        tempPicker = findViewById(R.id.temp_picker);
        displaySwitch = findViewById(R.id.display_switch);
        powerButton = findViewById(R.id.power_button);
        Button saveButton = findViewById(R.id.save_button);
        Button refreshButton = findViewById(R.id.refresh_button);

        applyEmbeddedConnectionDefaults();
        baseUrlInput.setText(prefs.getBaseUrl());
        deviceIdInput.setText(prefs.getDeviceId());
        tempPicker.setMinValue(AcStatus.MIN_TEMP);
        tempPicker.setMaxValue(AcStatus.MAX_TEMP);
        tempPicker.setWrapSelectorWheel(false);

        saveButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                saveConnection();
            }
        });
        refreshButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                refreshStatus();
            }
        });
        powerButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                togglePower();
            }
        });
        displaySwitch.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton buttonView, boolean isChecked) {
                if (!ignoreDisplayChange) {
                    setDisplay(isChecked);
                }
            }
        });
        tempPicker.setOnValueChangedListener(new NumberPicker.OnValueChangeListener() {
            @Override
            public void onValueChange(NumberPicker picker, int oldValue, int newValue) {
                if (!ignoreTempChange) {
                    setTemperature(newValue);
                }
            }
        });

        renderStatus(prefs.getLastStatus());
        if (prefs.hasBaseUrl()) {
            refreshStatus();
        }
    }

    private void applyEmbeddedConnectionDefaults() {
        if (!getResources().getBoolean(R.bool.use_embedded_connection_defaults)) {
            return;
        }
        String embeddedBaseUrl = getString(R.string.embedded_base_url).trim();
        String embeddedDeviceId = getString(R.string.embedded_device_id).trim();
        if (embeddedBaseUrl.length() > 0) {
            prefs.saveConnection(embeddedBaseUrl, embeddedDeviceId);
            connectionPanel.setVisibility(View.GONE);
        }
    }

    private void saveConnection() {
        prefs.saveConnection(baseUrlInput.getText().toString(), deviceIdInput.getText().toString());
        setStatus("Saved. Refreshing AC status...");
        AcWidgetProvider.updateAllWidgets(this);
        refreshStatus();
    }

    private void refreshStatus() {
        runStatusTask("Refreshing AC status...", new StatusTask() {
            @Override
            public AcStatus run(AcApiClient client) throws Exception {
                return client.fetchStatus();
            }
        });
    }

    private void setTemperature(final int temperatureCelsius) {
        prefs.saveTemperature(temperatureCelsius);
        AcWidgetProvider.updateAllWidgets(this);
        runStatusTask("Setting temperature to " + temperatureCelsius + " C...", new StatusTask() {
            @Override
            public AcStatus run(AcApiClient client) throws Exception {
                client.sendCommand("setTemperature", temperatureCelsius);
                return client.fetchStatus();
            }
        });
    }

    private void togglePower() {
        final boolean nextPower = !prefs.getLastStatus().powerOn;
        prefs.savePower(nextPower);
        renderStatus(prefs.getLastStatus());
        AcWidgetProvider.updateAllWidgets(this);
        runStatusTask(nextPower ? "Turning AC on..." : "Turning AC off...", new StatusTask() {
            @Override
            public AcStatus run(AcApiClient client) throws Exception {
                client.sendCommand(nextPower ? "turnOn" : "turnOff", null);
                return client.fetchStatus();
            }
        });
    }

    private void setDisplay(final boolean displayOn) {
        prefs.saveDisplay(displayOn);
        AcWidgetProvider.updateAllWidgets(this);
        runStatusTask(displayOn ? "Turning display on..." : "Turning display off...", new StatusTask() {
            @Override
            public AcStatus run(AcApiClient client) throws Exception {
                client.sendCommand("setDisplay", displayOn ? 1 : 0);
                return client.fetchStatus();
            }
        });
    }

    private void runStatusTask(final String loadingMessage, final StatusTask task) {
        if (!prefs.hasBaseUrl()) {
            setStatus("Set the service URL first.");
            return;
        }
        setStatus(loadingMessage);
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    AcApiClient client = new AcApiClient(prefs.getBaseUrl(), prefs.getDeviceId());
                    final AcStatus status = task.run(client);
                    prefs.saveStatus(status);
                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            renderStatus(status);
                            setStatus("Connected to " + prefs.getBaseUrl());
                            AcWidgetProvider.updateAllWidgets(MainActivity.this);
                        }
                    });
                } catch (final Exception error) {
                    prefs.saveError(error);
                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            setStatus("Error: " + error.getMessage());
                            AcWidgetProvider.updateAllWidgets(MainActivity.this);
                        }
                    });
                }
            }
        }, "BlueStarAcMainApi").start();
    }

    private void renderStatus(AcStatus status) {
        ignoreTempChange = true;
        tempPicker.setValue(status.temperatureCelsius);
        ignoreTempChange = false;

        ignoreDisplayChange = true;
        displaySwitch.setChecked(status.hasDisplay && status.displayOn);
        ignoreDisplayChange = false;

        String powerText = status.hasPower ? (status.powerOn ? "Power: on" : "Power: off") : "Power: unknown";
        powerState.setText(powerText);
        powerButton.setText(status.powerOn ? "Turn off" : "Turn on");

        String lastError = prefs.getLastError();
        if (lastError != null && lastError.length() > 0) {
            setStatus("Last error: " + lastError);
        }
    }

    private void setStatus(String message) {
        statusText.setText(message);
    }

    private interface StatusTask {
        AcStatus run(AcApiClient client) throws Exception;
    }
}
