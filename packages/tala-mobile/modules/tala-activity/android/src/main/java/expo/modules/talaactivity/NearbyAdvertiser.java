package expo.modules.talaactivity;

import android.app.Activity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.AdvertisingOptions;
import com.google.android.gms.nearby.connection.ConnectionInfo;
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback;
import com.google.android.gms.nearby.connection.ConnectionResolution;
import com.google.android.gms.nearby.connection.ConnectionsClient;
import com.google.android.gms.nearby.connection.Payload;
import com.google.android.gms.nearby.connection.PayloadCallback;
import com.google.android.gms.nearby.connection.PayloadTransferUpdate;
import com.google.android.gms.nearby.connection.Strategy;
import com.google.android.gms.tasks.OnFailureListener;
import com.google.android.gms.tasks.OnSuccessListener;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * The teacher's radio: advertise one class, accept every connection while advertising, forward
 * BYTES payloads to JavaScript, send what JavaScript asks. Protocol state (challenges, ingest,
 * replies) lives in the JS session (src/features/activity/session.ts) so it is unit-testable.
 *
 * Ported from Tala 0.4.4 NearbyCollector.kt (branch tala-0.4.x); written in Java like the student
 * module's TalaNearby.java so Kotlin 2.1 never has to read Nearby 19.4.0's Kotlin 2.3 metadata.
 */
public final class NearbyAdvertiser {
  public static final String SERVICE_ID = "com.hiraia.classroom.v1";
  /** Larger payloads are dropped and the endpoint disconnected (NearbyCollector.payloadCallback). */
  public static final int MAX_PAYLOAD_BYTES = 180_000;

  public interface Listener {
    void onEvent(String name, Map<String, String> body);
  }

  private final ConnectionsClient connections;
  private final Listener listener;
  private volatile boolean advertising;
  private int generation;

  public NearbyAdvertiser(Activity activity, Listener listener) {
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
          if (bytes.length > MAX_PAYLOAD_BYTES) {
            connections.disconnectFromEndpoint(endpointId);
            emit("onError", "endpointId", endpointId, "message", "payload-too-large");
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
          if (advertising) {
            emit("onConnection", "endpointId", endpointId, "status", "initiated");
            connections.acceptConnection(endpointId, payloadCallback);
          } else connections.rejectConnection(endpointId);
        }

        @Override
        public void onConnectionResult(String endpointId, ConnectionResolution result) {
          if (!advertising) return;
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

  public void startAdvertising(String endpointName, OnSuccessListener<Void> ok, OnFailureListener fail) {
    if (advertising) {
      ok.onSuccess(null);
      return;
    }
    advertising = true;
    final int started = ++generation;
    connections
        .startAdvertising(
            endpointName,
            SERVICE_ID,
            connectionCallback,
            new AdvertisingOptions.Builder().setStrategy(Strategy.P2P_STAR).build())
        .addOnSuccessListener(ok)
        .addOnFailureListener(
            e -> {
              if (generation == started) advertising = false;
              fail.onFailure(e);
            });
  }

  public boolean isAdvertising() {
    return advertising;
  }

  /** The Nearby status code of a failure, or -1: JS maps it to a plain-language message. */
  public static int statusCode(Exception e) {
    return e instanceof ApiException ? ((ApiException) e).getStatusCode() : -1;
  }

  public void send(String endpointId, String json, OnSuccessListener<Void> ok, OnFailureListener fail) {
    byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
    if (bytes.length > MAX_PAYLOAD_BYTES) {
      fail.onFailure(new IllegalArgumentException("payload-too-large"));
      return;
    }
    connections.sendPayload(endpointId, Payload.fromBytes(bytes)).addOnSuccessListener(ok).addOnFailureListener(fail);
  }

  public void disconnect(String endpointId) {
    connections.disconnectFromEndpoint(endpointId);
  }

  /** NearbyCollector.stop: no more advertising, every student dropped. */
  public void stop() {
    advertising = false;
    generation++;
    connections.stopAdvertising();
    connections.stopAllEndpoints();
  }
}
