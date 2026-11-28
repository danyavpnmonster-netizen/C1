package com.sunrisebay.game;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothServerSocket;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Связь двух телефонов по Bluetooth (RFCOMM) для игры вдвоём.
 * Один телефон ждёт подключения (host), второй подключается к нему по адресу (connect).
 * Сообщения — строки JSON, по одной на строку. В JavaScript события приходят
 * через window.__bt(тип, данные): state, peer, msg, error, perm.
 */
@SuppressLint("MissingPermission")
public class BtBridge {
    static final int PERM_REQUEST = 7;
    private static final UUID SERVICE = UUID.fromString("5b3e1a2c-7d4f-4c1e-9a0b-2f6c8d1e3a57");

    private final Activity act;
    private final WebView web;
    private final BluetoothAdapter adapter;
    private final ExecutorService sender = Executors.newSingleThreadExecutor();
    private volatile BluetoothServerSocket server;
    private volatile BluetoothSocket socket;
    private volatile OutputStream out;
    private volatile int generation = 0;   // чтобы старые потоки не мешали новому соединению

    BtBridge(Activity act, WebView web) {
        this.act = act;
        this.web = web;
        BluetoothManager bm = (BluetoothManager) act.getSystemService(Context.BLUETOOTH_SERVICE);
        this.adapter = bm != null ? bm.getAdapter() : null;
    }

    private boolean hasPermission() {
        if (Build.VERSION.SDK_INT < 31) return true;
        return act.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    @JavascriptInterface
    public boolean available() { return adapter != null; }

    @JavascriptInterface
    public boolean enabled() {
        try { return adapter != null && adapter.isEnabled(); } catch (Exception e) { return false; }
    }

    @JavascriptInterface
    public void requestPermission() {
        if (Build.VERSION.SDK_INT >= 31 && !hasPermission()) {
            act.runOnUiThread(() -> act.requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, PERM_REQUEST));
        } else {
            emit("perm", "ok");
        }
    }

    void onPermission(boolean ok) { emit("perm", ok ? "ok" : "denied"); }

    @JavascriptInterface
    public void enable() {
        if (!hasPermission()) { requestPermission(); return; }
        act.runOnUiThread(() -> {
            try { act.startActivity(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)); }
            catch (Exception e) { emit("error", "не удалось включить Bluetooth"); }
        });
    }

    /** Список сопряжённых устройств: [{name, address}]. */
    @JavascriptInterface
    public String paired() {
        JSONArray list = new JSONArray();
        if (adapter == null || !hasPermission()) return list.toString();
        try {
            for (BluetoothDevice d : adapter.getBondedDevices()) {
                JSONObject o = new JSONObject();
                o.put("name", d.getName() != null ? d.getName() : d.getAddress());
                o.put("address", d.getAddress());
                list.put(o);
            }
        } catch (Exception e) {
            emit("error", String.valueOf(e.getMessage()));
        }
        return list.toString();
    }

    /** Ждать подключения второго игрока. */
    @JavascriptInterface
    public void host() {
        if (!ready()) return;
        close();
        final int gen = ++generation;
        new Thread(() -> {
            try {
                server = adapter.listenUsingInsecureRfcommWithServiceRecord("SunriseBay", SERVICE);
                setState("hosting");
                BluetoothSocket s = server.accept();
                closeServer();
                if (gen != generation) { s.close(); return; }
                attach(s, gen);
            } catch (Exception e) {
                if (gen == generation) { emit("error", String.valueOf(e.getMessage())); setState("error"); }
            }
        }, "bt-host").start();
    }

    /** Подключиться к телефону, который создал игру. */
    @JavascriptInterface
    public void connect(String address) {
        if (!ready()) return;
        close();
        final int gen = ++generation;
        new Thread(() -> {
            try {
                setState("connecting");
                BluetoothDevice d = adapter.getRemoteDevice(address);
                try { adapter.cancelDiscovery(); } catch (Exception ignored) { }
                BluetoothSocket s = d.createInsecureRfcommSocketToServiceRecord(SERVICE);
                s.connect();
                if (gen != generation) { s.close(); return; }
                attach(s, gen);
            } catch (Exception e) {
                if (gen == generation) { emit("error", String.valueOf(e.getMessage())); setState("error"); }
            }
        }, "bt-connect").start();
    }

    private boolean ready() {
        if (adapter == null) { emit("error", "на телефоне нет Bluetooth"); return false; }
        if (!hasPermission()) { requestPermission(); return false; }
        if (!enabled()) { emit("error", "Bluetooth выключен"); return false; }
        return true;
    }

    private void attach(BluetoothSocket s, int gen) throws IOException {
        socket = s;
        out = s.getOutputStream();
        final BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
        String name;
        try { name = s.getRemoteDevice().getName(); } catch (Exception e) { name = null; }
        emit("peer", name != null ? name : "Игрок 2");
        setState("connected");
        new Thread(() -> {
            try {
                String line;
                while ((line = in.readLine()) != null) emit("msg", line);
            } catch (IOException ignored) { }
            if (gen == generation) { closeSocket(); setState("closed"); }
        }, "bt-read").start();
    }

    @JavascriptInterface
    public void send(String line) {
        final OutputStream o = out;
        if (o == null) return;
        final byte[] data = (line + "\n").getBytes(StandardCharsets.UTF_8);
        sender.execute(() -> {
            try { o.write(data); o.flush(); } catch (IOException ignored) { }
        });
    }

    @JavascriptInterface
    public void close() {
        generation++;
        closeServer();
        closeSocket();
    }

    private void closeServer() {
        BluetoothServerSocket s = server;
        server = null;
        if (s != null) try { s.close(); } catch (IOException ignored) { }
    }

    private void closeSocket() {
        BluetoothSocket s = socket;
        socket = null;
        out = null;
        if (s != null) try { s.close(); } catch (IOException ignored) { }
    }

    private void setState(String s) { emit("state", s); }

    private void emit(String type, String data) {
        final String js = "window.__bt&&window.__bt(" + JSONObject.quote(type) + "," + JSONObject.quote(data == null ? "" : data) + ")";
        act.runOnUiThread(() -> web.evaluateJavascript(js, null));
    }
}
