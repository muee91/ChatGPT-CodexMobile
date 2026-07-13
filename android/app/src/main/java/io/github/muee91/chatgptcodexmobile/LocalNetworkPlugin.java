package io.github.muee91.chatgptcodexmobile;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "LocalNetwork")
public class LocalNetworkPlugin extends Plugin {

    @PluginMethod
    public void getLocalIpv4Addresses(PluginCall call) {
        JSObject result = new JSObject();
        JSArray addresses = new JSArray();

        for (String address : readLocalIpv4Addresses()) {
            addresses.put(address);
        }

        result.put("addresses", addresses);
        call.resolve(result);
    }

    @PluginMethod
    public void scanLanServers(PluginCall call) {
        JSArray seedUrls = call.getArray("seedUrls", new JSArray());
        JSArray hostNumbers = call.getArray("hostNumbers", new JSArray());
        int timeoutMs = call.getInt("timeoutMs", 900);

        new Thread(() -> {
            JSObject result = new JSObject();
            JSArray matches = new JSArray();
            for (JSObject entry : probeLanServers(seedUrls, hostNumbers, timeoutMs)) {
                matches.put(entry);
            }
            result.put("results", matches);
            call.resolve(result);
        }).start();
    }

    private List<String> readLocalIpv4Addresses() {
        List<String> wifiAddresses = readWifiIpv4Addresses();
        if (!wifiAddresses.isEmpty()) {
            return wifiAddresses;
        }
        List<String> activeAddresses = readActiveNetworkIpv4Addresses();
        if (!activeAddresses.isEmpty()) {
            return activeAddresses;
        }
        return readPrivateIpv4AddressesFromAllInterfaces();
    }

    private List<String> readWifiIpv4Addresses() {
        List<String> addresses = new ArrayList<>();
        try {
            WifiManager manager = (WifiManager) getContext().getApplicationContext()
                .getSystemService(Context.WIFI_SERVICE);
            if (manager == null) {
                return addresses;
            }
            WifiInfo wifiInfo = manager.getConnectionInfo();
            if (wifiInfo == null) {
                return addresses;
            }
            int rawIp = wifiInfo.getIpAddress();
            if (rawIp == 0) {
                return addresses;
            }
            String address = String.format(
                Locale.ROOT,
                "%d.%d.%d.%d",
                rawIp & 0xff,
                (rawIp >> 8) & 0xff,
                (rawIp >> 16) & 0xff,
                (rawIp >> 24) & 0xff
            );
            if (isPrivateIpv4(address) && !addresses.contains(address)) {
                addresses.add(address);
            }
        } catch (Exception ignored) {
            return addresses;
        }
        return addresses;
    }

    private List<String> readActiveNetworkIpv4Addresses() {
        List<String> addresses = new ArrayList<>();
        try {
            ConnectivityManager manager = (ConnectivityManager) getContext()
                .getSystemService(Context.CONNECTIVITY_SERVICE);
            if (manager == null) {
                return addresses;
            }
            Network network = manager.getActiveNetwork();
            if (network == null) {
                return addresses;
            }
            LinkProperties properties = manager.getLinkProperties(network);
            if (properties == null) {
                return addresses;
            }
            for (LinkAddress linkAddress : properties.getLinkAddresses()) {
                InetAddress address = linkAddress.getAddress();
                if (!(address instanceof Inet4Address)) {
                    continue;
                }
                String hostAddress = address.getHostAddress();
                if (hostAddress == null || hostAddress.isEmpty() || !isPrivateIpv4(hostAddress)) {
                    continue;
                }
                if (!addresses.contains(hostAddress)) {
                    addresses.add(hostAddress);
                }
            }
        } catch (Exception ignored) {
            return addresses;
        }
        return addresses;
    }

    private List<String> readPrivateIpv4AddressesFromAllInterfaces() {
        List<String> addresses = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            if (interfaces == null) {
                return addresses;
            }
            for (NetworkInterface networkInterface : Collections.list(interfaces)) {
                if (!networkInterface.isUp() || networkInterface.isLoopback() || networkInterface.isVirtual()) {
                    continue;
                }
                for (InetAddress address : Collections.list(networkInterface.getInetAddresses())) {
                    if (!(address instanceof Inet4Address)) {
                        continue;
                    }
                    String hostAddress = address.getHostAddress();
                    if (hostAddress == null || hostAddress.isEmpty() || !isPrivateIpv4(hostAddress)) {
                        continue;
                    }
                    if (!addresses.contains(hostAddress)) {
                        addresses.add(hostAddress);
                    }
                }
            }
        } catch (Exception ignored) {
            return addresses;
        }
        return addresses;
    }

    private List<JSObject> probeLanServers(JSArray seedUrls, JSArray hostNumbers, int timeoutMs) {
        Set<String> candidates = buildCandidates(seedUrls, hostNumbers);
        if (candidates.isEmpty()) {
            return new ArrayList<>();
        }

        int workerCount = Math.max(1, Math.min(24, candidates.size()));
        ExecutorService executor = Executors.newFixedThreadPool(workerCount);
        List<Future<JSObject>> futures = new ArrayList<>();
        try {
            for (String baseUrl : candidates) {
                futures.add(executor.submit(new ProbeTask(baseUrl, timeoutMs)));
            }
            long waitSliceMs = Math.max(150L, timeoutMs);
            while (!futures.isEmpty()) {
                for (int index = 0; index < futures.size(); index += 1) {
                    Future<JSObject> future = futures.get(index);
                    if (!future.isDone()) {
                        continue;
                    }
                    futures.remove(index);
                    index -= 1;
                    JSObject match = future.get();
                    if (match != null) {
                        for (Future<JSObject> pending : futures) {
                            pending.cancel(true);
                        }
                        List<JSObject> results = new ArrayList<>();
                        results.add(match);
                        return results;
                    }
                }
                if (!futures.isEmpty()) {
                    Thread.sleep(waitSliceMs);
                }
            }
        } catch (Exception ignored) {
            return new ArrayList<>();
        } finally {
            executor.shutdownNow();
            try {
                executor.awaitTermination(200, TimeUnit.MILLISECONDS);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }
        return new ArrayList<>();
    }

    private Set<String> buildCandidates(JSArray seedUrls, JSArray hostNumbers) {
        Set<String> candidates = new LinkedHashSet<>();
        JSArray effectiveSeedUrls = seedUrls;
        if (effectiveSeedUrls == null || effectiveSeedUrls.length() == 0) {
            effectiveSeedUrls = new JSArray();
            for (String address : readLocalIpv4Addresses()) {
                effectiveSeedUrls.put("http://" + address + ":3321");
            }
        }
        List<Integer> effectiveHostNumbers = readHostNumbers(hostNumbers);
        if (effectiveHostNumbers.isEmpty()) {
            for (int hostNumber = 1; hostNumber <= 254; hostNumber += 1) {
                effectiveHostNumbers.add(hostNumber);
            }
        }
        for (int seedIndex = 0; seedIndex < effectiveSeedUrls.length(); seedIndex += 1) {
            String seedUrl = effectiveSeedUrls.optString(seedIndex, "").trim();
            if (seedUrl.isEmpty()) {
                continue;
            }
            try {
                URL parsed = new URL(seedUrl);
                String host = parsed.getHost();
                String[] parts = host.split("\\.");
                if (parts.length != 4) {
                    continue;
                }
                String prefix = parts[0] + "." + parts[1] + "." + parts[2] + ".";
                int port = parsed.getPort() > 0 ? parsed.getPort() : 3321;
                String protocol = "https".equalsIgnoreCase(parsed.getProtocol()) ? "https" : "http";
                for (Integer hostNumber : effectiveHostNumbers) {
                    if (hostNumber < 1 || hostNumber > 254) {
                        continue;
                    }
                    candidates.add(protocol + "://" + prefix + hostNumber + ":" + port);
                }
            } catch (Exception ignored) {
                // ignore
            }
        }
        return candidates;
    }

    private List<Integer> readHostNumbers(JSArray hostNumbers) {
        List<Integer> values = new ArrayList<>();
        if (hostNumbers == null) {
            return values;
        }
        for (int index = 0; index < hostNumbers.length(); index += 1) {
            int hostNumber = hostNumbers.optInt(index, -1);
            if (hostNumber >= 1 && hostNumber <= 254 && !values.contains(hostNumber)) {
                values.add(hostNumber);
            }
        }
        return values;
    }

    private JSObject probeStatus(String baseUrl, int timeoutMs) {
        for (String path : new String[] { "/api/discovery", "/api/status" }) {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(baseUrl + path);
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(timeoutMs);
                connection.setReadTimeout(timeoutMs);
                connection.setUseCaches(false);
                connection.setRequestProperty("Accept", "application/json");
                int statusCode = connection.getResponseCode();
                if (statusCode < 200 || statusCode >= 300) {
                    if ("/api/discovery".equals(path)) {
                        continue;
                    }
                    return null;
                }
                StringBuilder body = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        body.append(line);
                    }
                }
                JSONObject data = new JSONObject(body.toString());
                if (!data.optBoolean("connected", false)) {
                    return null;
                }
                JSONObject auth = data.optJSONObject("auth");
                JSObject result = new JSObject();
                result.put("url", baseUrl);
                result.put("hostName", data.optString("hostName", "").trim());
                result.put("port", data.optInt("port", 0));
                result.put("canPair", auth == null || auth.optBoolean("canPair", true));
                return result;
            } catch (Exception ignored) {
                return null;
            } finally {
                if (connection != null) {
                    connection.disconnect();
                }
            }
        }
        return null;
    }

    private final class ProbeTask implements Callable<JSObject> {
        private final String baseUrl;
        private final int timeoutMs;

        private ProbeTask(String baseUrl, int timeoutMs) {
            this.baseUrl = baseUrl;
            this.timeoutMs = timeoutMs;
        }

        @Override
        public JSObject call() {
            if (Thread.currentThread().isInterrupted()) {
                return null;
            }
            return probeStatus(baseUrl, timeoutMs);
        }
    }

    private boolean isPrivateIpv4(String address) {
        String[] parts = address.split("\\.");
        if (parts.length != 4) {
            return false;
        }
        try {
            int a = Integer.parseInt(parts[0]);
            int b = Integer.parseInt(parts[1]);
            return a == 10 ||
                (a == 192 && b == 168) ||
                (a == 172 && b >= 16 && b <= 31);
        } catch (NumberFormatException error) {
            return false;
        }
    }
}
