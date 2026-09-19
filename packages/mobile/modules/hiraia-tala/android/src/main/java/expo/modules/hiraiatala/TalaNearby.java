package expo.modules.hiraiatala;

import android.app.Activity;
import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.AdvertisingOptions;
import com.google.android.gms.nearby.connection.ConnectionInfo;
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback;
import com.google.android.gms.nearby.connection.ConnectionResolution;
import com.google.android.gms.nearby.connection.ConnectionsClient;
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo;
import com.google.android.gms.nearby.connection.DiscoveryOptions;
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback;
import com.google.android.gms.nearby.connection.Payload;
import com.google.android.gms.nearby.connection.PayloadCallback;
import com.google.android.gms.nearby.connection.PayloadTransferUpdate;
import com.google.android.gms.nearby.connection.Strategy;
import com.google.android.gms.tasks.OnFailureListener;
import com.google.android.gms.tasks.OnSuccessListener;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** Java wrapper so Kotlin 2.1 does not load Nearby 19.4.0's Kotlin 2.3 metadata. */
public final class TalaNearby {
  public static final String SERVICE_ID = "com.hiraia.classroom.v1";

  public interface Listener {
    void onEvent(String name, Map<String, String> body);
  }

  private final ConnectionsClient connections;
  private final Listener listener;
  private volatile boolean discovering;

  public TalaNearby(Activity activity, Listener listener) {
    this.connections = Nearby.getConnectionsClient(activity);
    this.listener = listener;
  }

  private void emit(String name, String... kv) {
    Map<String, String> body = new HashMap<>();
    for (int i = 0; i + 1 < kv.length; i += 2) body.put(kv[i], kv[i + 1]);
    listener.onEvent(name, body);
  }

  private final PayloadCallback payloadCallback =
      new PayloadCallback() {
        @Override
        public void onPayloadReceived(String endpointId, Payload payload) {
          if (payload.getType() != Payload.Type.BYTES) return;
          byte[] bytes = payload.asBytes();
          if (bytes == null) return;
          if (bytes.length > 180_000) {
            connections.disconnectFromEndpoint(endpointId);
            emit("onError", "message", "payload-too-large", "endpointId", endpointId);
            return;
          }
          emit("onBytes", "endpointId", endpointId, "json", new String(bytes, StandardCharsets.UTF_8));
        }

        @Override
        public void onPayloadTransferUpdate(String endpointId, PayloadTransferUpdate update) {}
      };

  private final ConnectionLifecycleCallback connectionCallback =
      new ConnectionLifecycleCallback() {
        @Override
        public void onConnectionInitiated(String endpointId, ConnectionInfo info) {
          if (discovering) connections.acceptConnection(endpointId, payloadCallback);
          else connections.rejectConnection(endpointId);
        }

        @Override
        public void onConnectionResult(String endpointId, ConnectionResolution result) {
          emit(
              "onConnection",
              "endpointId",
              endpointId,
              "status",
              result.getStatus().isSuccess() ? "connected" : "failed");
        }

        @Override
        public void onDisconnected(String endpointId) {
          emit("onConnection", "endpointId", endpointId, "status", "disconnected");
        }
      };

  private final EndpointDiscoveryCallback discoveryCallback =
      new EndpointDiscoveryCallback() {
        @Override
        public void onEndpointFound(String endpointId, DiscoveredEndpointInfo info) {
          emit("onFound", "endpointId", endpointId);
        }

        @Override
        public void onEndpointLost(String endpointId) {
          emit("onLost", "endpointId", endpointId);
        }
      };

  public void startDiscovery(OnSuccessListener<Void> ok, OnFailureListener fail) {
    if (discovering) {
      ok.onSuccess(null);
      return;
    }
    discovering = true;
    connections
        .startDiscovery(
            SERVICE_ID,
            discoveryCallback,
            new DiscoveryOptions.Builder().setStrategy(Strategy.P2P_STAR).build())
        .addOnSuccessListener(ok)
        .addOnFailureListener(
            e -> {
              discovering = false;
              fail.onFailure(e);
            });
  }

  public void requestConnection(String endpointId, OnSuccessListener<Void> ok, OnFailureListener fail) {
    connections
        .requestConnection("Hiraia", endpointId, connectionCallback)
        .addOnSuccessListener(ok)
        .addOnFailureListener(fail);
  }

  public void send(String endpointId, String json, OnSuccessListener<Void> ok, OnFailureListener fail) {
    byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
    if (bytes.length > 180_000) {
      fail.onFailure(new IllegalArgumentException("payload-too-large"));
      return;
    }
    connections.sendPayload(endpointId, Payload.fromBytes(bytes)).addOnSuccessListener(ok).addOnFailureListener(fail);
  }

  public void stop() {
    discovering = false;
    connections.stopDiscovery();
    connections.stopAllEndpoints();
  }
}
