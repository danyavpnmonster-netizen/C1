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
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Сервер для игры по Wi-Fi (до 8 игроков). Один телефон держит сервер («Сервер #1»),
 * остальные в той же сети находят его по UDP-объявлению и подключаются по TCP.
 *
 * Протокол — строки JSON. Сервер пересылает каждую строку всем остальным,
 * добавляя номер отправителя: "номер|json". Номер хоста — 0.
 * События в JS: window.__bt(тип, данные): state, msg, error, found.
 */
public class NetBridge {
    static final int TCP_PORT = 47777;
    static final int UDP_PORT = 47778;
    private static final String TAG = "SUNRISEBAY2";

    private final Activity act;
    private final WebView web;
    private final ExecutorService sender = Executors.newSingleThreadExecutor();
    private final Map<String, JSONObject> found = Collections.synchronizedMap(new LinkedHashMap<>());
    private WifiManager.MulticastLock lock;

    // режим сервера
    private volatile ServerSocket server;
    private final Map<Integer, Peer> peers = new ConcurrentHashMap<>();
    private volatile int nextId = 1;
    private volatile int maxPlayers = 8;
    private volatile String serverName = "Сервер #1";
    // режим клиента
    private volatile Socket socket;
    private volatile OutputStream out;
    private volatile DatagramSocket scanSock;
    private volatile int generation = 0;

    private static final class Peer {
        final int id; final Socket s; final OutputStream out;
        Peer(int id, Socket s) throws IOException { this.id = id; this.s = s; this.out = s.getOutputStream(); }
    }

    NetBridge(Activity act, WebView web) {
        this.act = act;
        this.web = web;
    }

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

    @JavascriptInterface
    public String device() { return Build.MODEL == null ? "Телефон" : Build.MODEL; }

    /** Найденные серверы: [{address, name, players, max}]. */
    @JavascriptInterface
    public String games() {
        JSONArray list = new JSONArray();
        synchronized (found) { for (JSONObject o : found.values()) list.put(o); }
        return list.toString();
    }

    /** Слушать объявления серверов в локальной сети. */
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
                long until = System.currentTimeMillis() + 120000;
                while (scanSock == ds && System.currentTimeMillis() < until) {
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    try { ds.receive(p); } catch (java.net.SocketTimeoutException t) { continue; }
                    String[] parts = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8).split("\\|");
                    if (parts.length < 4 || !TAG.equals(parts[0])) continue;
                    String ip = p.getAddress().getHostAddress();
                    JSONObject o = new JSONObject();
                    o.put("address", ip); o.put("name", parts[1]);
                    o.put("players", Integer.parseInt(parts[2])); o.put("max", Integer.parseInt(parts[3]));
                    JSONObject old = found.get(ip);
                    if (old == null || old.optInt("players") != o.optInt("players")) { found.put(ip, o); emit("found", games()); }
                }
            } catch (Exception e) {
                if (scanSock == ds) emit("error", "поиск серверов: " + e.getMessage());
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

    // ---------------- сервер ----------------

    /** Запустить сервер на этом телефоне. Хост сразу в игре под номером 0. */
    @JavascriptInterface
    public void host(String name, int max) {
        close();
        final int gen = ++generation;
        serverName = name == null || name.isEmpty() ? "Сервер #1" : name.replace("|", " ");
        maxPlayers = Math.max(2, Math.min(8, max));
        nextId = 1;
        new Thread(() -> {
            try {
                ServerSocket ss = new ServerSocket();
                ss.setReuseAddress(true);
                ss.bind(new InetSocketAddress(TCP_PORT));
                server = ss;
                emit("welcome", "0");
                setState("connected");
                startBeacon(gen);
                while (gen == generation) {
                    Socket s = ss.accept();
                    s.setTcpNoDelay(true);
                    if (peers.size() + 1 >= maxPlayers) {
                        try { s.getOutputStream().write("0|{\"t\":\"full\"}\n".getBytes(StandardCharsets.UTF_8)); } catch (IOException ignored) { }
                        s.close();
                        continue;
                    }
                    final Peer p = new Peer(nextId++, s);
                    peers.put(p.id, p);
                    write(p, "0|{\"t\":\"welcome\",\"id\":" + p.id + "}");
                    emit("msg", p.id + "|{\"t\":\"join\"}");
                    broadcast(p.id + "|{\"t\":\"join\"}", p.id);
                    new Thread(() -> readPeer(p, gen), "net-peer-" + p.id).start();
                }
            } catch (Exception e) {
                if (gen == generation) { emit("error", String.valueOf(e.getMessage())); setState("error"); }
            }
        }, "net-host").start();
    }

    private void readPeer(Peer p, int gen) {
        try {
            BufferedReader in = new BufferedReader(new InputStreamReader(p.s.getInputStream(), StandardCharsets.UTF_8));
            String line;
            while ((line = in.readLine()) != null && gen == generation) {
                String tagged = p.id + "|" + line;
                emit("msg", tagged);
                broadcast(tagged, p.id);
            }
        } catch (IOException ignored) { }
        peers.remove(p.id);
        try { p.s.close(); } catch (IOException ignored) { }
        if (gen == generation) {
            String bye = p.id + "|{\"t\":\"bye\"}";
            emit("msg", bye);
            broadcast(bye, p.id);
        }
    }

    private void write(Peer p, String line) {
        final byte[] data = (line + "\n").getBytes(StandardCharsets.UTF_8);
        sender.execute(() -> { try { p.out.write(data); p.out.flush(); } catch (IOException ignored) { } });
    }

    private void broadcast(String line, int except) {
        for (Peer p : peers.values()) if (p.id != except) write(p, line);
    }

    private void startBeacon(final int gen) {
        new Thread(() -> {
            try (DatagramSocket ds = new DatagramSocket()) {
                ds.setBroadcast(true);
                while (gen == generation && server != null) {
                    byte[] msg = (TAG + "|" + serverName + "|" + (peers.size() + 1) + "|" + maxPlayers + "|" + TCP_PORT)
                            .getBytes(StandardCharsets.UTF_8);
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

    // ---------------- клиент ----------------

    /** Подключиться к серверу по IP-адресу. */
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
                s.setTcpNoDelay(true);
                socket = s;
                out = s.getOutputStream();
                BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
                setState("connected");
                String line;
                while ((line = in.readLine()) != null) emit("msg", line);
                if (gen == generation) { closeSocket(); setState("closed"); }
            } catch (Exception e) {
                if (gen == generation) { emit("error", String.valueOf(e.getMessage())); setState("error"); }
            }
        }, "net-connect").start();
    }

    /** Отправить своё сообщение: хост рассылает всем, клиент — серверу. */
    @JavascriptInterface
    public void send(String line) {
        if (server != null) { broadcast("0|" + line, -1); return; }
        final OutputStream o = out;
        if (o == null) return;
        final byte[] data = (line + "\n").getBytes(StandardCharsets.UTF_8);
        sender.execute(() -> { try { o.write(data); o.flush(); } catch (IOException ignored) { } });
    }

    @JavascriptInterface
    public int players() { return server != null ? peers.size() + 1 : 0; }

    @JavascriptInterface
    public void close() {
        generation++;
        ServerSocket ss = server;
        server = null;
        if (ss != null) try { ss.close(); } catch (IOException ignored) { }
        for (Peer p : peers.values()) try { p.s.close(); } catch (IOException ignored) { }
        peers.clear();
        closeSocket();
    }

    void shutdown() {
        close();
        stopScan();
        try { if (lock != null && lock.isHeld()) lock.release(); } catch (Exception ignored) { }
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
