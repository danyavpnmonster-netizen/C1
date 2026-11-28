package com.sunrisebay.game;

import android.app.Activity;
import android.content.Context;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Игра вдвоём по общей сети Wi-Fi (или точке доступа одного из телефонов).
 * Хост открывает TCP-порт и раз в секунду рассылает UDP-объявление в локальную сеть;
 * второй телефон слушает объявления и показывает найденные игры. Можно подключиться и по IP.
 * Сообщения — строки JSON, по одной на строку. События в JS: window.__bt(тип, данные):
 * state, peer, msg, error, found.
 */
public class NetBridge {
    static final int TCP_PORT = 47777;
    static final int UDP_PORT = 47778;
    private static final String TAG = "SUNRISEBAY";

    private final Activity act;
    private final WebView web;
    private final ExecutorService sender = Executors.newSingleThreadExecutor();
    private final Map<String, String> found = Collections.synchronizedMap(new LinkedHashMap<>());
    private WifiManager.MulticastLock lock;
    private volatile ServerSocket server;
    private volatile Socket socket;
    private volatile OutputStream out;
    private volatile DatagramSocket scanSock;
    private volatile int generation = 0;

    NetBridge(Activity act, WebView web) {
        this.act = act;
        this.web = web;
    }

    private static String deviceName() {
        String m = Build.MODEL;
        return m == null || m.isEmpty() ? "Телефон" : m;
    }

    /** IPv4-адреса этого телефона в локальных сетях (Wi-Fi, точка доступа). */
    private static List<InterfaceAddress> lanAddresses() {
        List<InterfaceAddress> res = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    if (ia.getAddress() instanceof Inet4Address && ia.getAddress().isSiteLocalAddress()) res.add(ia);
                }
            }
        } catch (Exception ignored) { }
        return res;
    }

    @JavascriptInterface
    public String myIp() {
        StringBuilder sb = new StringBuilder();
        for (InterfaceAddress ia : lanAddresses()) {
            if (sb.length() > 0) sb.append(", ");
            sb.append(ia.getAddress().getHostAddress());
        }
        return sb.toString();
    }

    @JavascriptInterface
    public boolean online() { return !lanAddresses().isEmpty(); }

    /** Найденные игры в сети: [{name, address}]. */
    @JavascriptInterface
    public String games() {
        JSONArray list = new JSONArray();
        synchronized (found) {
            for (Map.Entry<String, String> e : found.entrySet()) {
                try {
                    JSONObject o = new JSONObject();
                    o.put("address", e.getKey());
                    o.put("name", e.getValue());
                    list.put(o);
                } catch (Exception ignored) { }
            }
        }
        return list.toString();
    }

    /** Слушать объявления игр в локальной сети. */
    @JavascriptInterface
    public void scan() {
        stopScan();
        found.clear();
        acquireLock();
        new Thread(() -> {
            DatagramSocket ds = null;
            try {
                ds = new DatagramSocket(null);
                ds.setReuseAddress(true);
                ds.setBroadcast(true);
                ds.bind(new InetSocketAddress(UDP_PORT));
                ds.setSoTimeout(1000);
                scanSock = ds;
                byte[] buf = new byte[512];
                long until = System.currentTimeMillis() + 60000;
                while (scanSock == ds && System.currentTimeMillis() < until) {
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    try { ds.receive(p); } catch (java.net.SocketTimeoutException t) { continue; }
                    String s = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8);
                    String[] parts = s.split("\\|");
                    if (parts.length >= 2 && TAG.equals(parts[0])) {
                        String ip = p.getAddress().getHostAddress();
                        if (!found.containsKey(ip)) { found.put(ip, parts[1]); emit("found", games()); }
                    }
                }
            } catch (Exception e) {
                if (scanSock == ds) emit("error", "поиск в сети: " + e.getMessage());
            } finally {
                if (ds != null) ds.close();
            }
        }, "net-scan").start();
    }

    private void stopScan() {
        DatagramSocket s = scanSock;
        scanSock = null;
        if (s != null) s.close();
    }

    private void acquireLock() {
        try {
            if (lock == null) {
                WifiManager wm = (WifiManager) act.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) { lock = wm.createMulticastLock("sunrisebay"); lock.setReferenceCounted(false); }
            }
            if (lock != null) lock.acquire();
        } catch (Exception ignored) { }
    }

    /** Создать игру: ждать подключения и объявлять себя в сети. */
    @JavascriptInterface
    public void host() {
        close();
        final int gen = ++generation;
        new Thread(() -> {
            try {
                ServerSocket ss = new ServerSocket();
                ss.setReuseAddress(true);
                ss.bind(new InetSocketAddress(TCP_PORT));
                server = ss;
                setState("hosting");
                startBeacon(gen);
                Socket s = ss.accept();
                closeServer();
                if (gen != generation) { s.close(); return; }
                attach(s, gen);
            } catch (Exception e) {
                if (gen == generation) { emit("error", String.valueOf(e.getMessage())); setState("error"); }
            }
        }, "net-host").start();
    }

    private void startBeacon(final int gen) {
        new Thread(() -> {
            try (DatagramSocket ds = new DatagramSocket()) {
                ds.setBroadcast(true);
                byte[] msg = (TAG + "|" + deviceName() + "|" + TCP_PORT).getBytes(StandardCharsets.UTF_8);
                while (gen == generation && server != null) {
                    List<InetAddress> targets = new ArrayList<>();
                    targets.add(InetAddress.getByName("255.255.255.255"));
                    for (InterfaceAddress ia : lanAddresses()) if (ia.getBroadcast() != null) targets.add(ia.getBroadcast());
                    for (InetAddress t : targets) {
                        try { ds.send(new DatagramPacket(msg, msg.length, t, UDP_PORT)); } catch (IOException ignored) { }
                    }
                    Thread.sleep(1000);
                }
            } catch (Exception ignored) { }
        }, "net-beacon").start();
    }

    /** Подключиться к игре по IP-адресу. */
    @JavascriptInterface
    public void connect(String address) {
        close();
        final int gen = ++generation;
        new Thread(() -> {
            try {
                setState("connecting");
                Socket s = new Socket();
                s.connect(new InetSocketAddress(address.trim(), TCP_PORT), 6000);
                if (gen != generation) { s.close(); return; }
                attach(s, gen);
            } catch (Exception e) {
                if (gen == generation) { emit("error", String.valueOf(e.getMessage())); setState("error"); }
            }
        }, "net-connect").start();
    }

    private void attach(Socket s, int gen) throws IOException {
        stopScan();
        s.setTcpNoDelay(true);
        socket = s;
        out = s.getOutputStream();
        final BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
        String peer = found.get(s.getInetAddress().getHostAddress());
        emit("peer", peer != null ? peer : s.getInetAddress().getHostAddress());
        setState("connected");
        new Thread(() -> {
            try {
                String line;
                while ((line = in.readLine()) != null) emit("msg", line);
            } catch (IOException ignored) { }
            if (gen == generation) { closeSocket(); setState("closed"); }
        }, "net-read").start();
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

    void shutdown() {
        close();
        stopScan();
        try { if (lock != null && lock.isHeld()) lock.release(); } catch (Exception ignored) { }
    }

    private void closeServer() {
        ServerSocket s = server;
        server = null;
        if (s != null) try { s.close(); } catch (IOException ignored) { }
    }

    private void closeSocket() {
        Socket s = socket;
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
