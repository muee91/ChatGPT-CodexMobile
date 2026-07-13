package io.github.muee91.chatgptcodexmobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalNetworkPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
