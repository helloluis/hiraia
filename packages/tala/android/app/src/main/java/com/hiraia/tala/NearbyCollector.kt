package com.hiraia.tala

import android.app.Activity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

class NearbyCollector(
    private val activity: Activity,
    private val identity: ClassIdentity,
    private val database: TalaDatabase,
    private val manualEnrollment: ManualEnrollment,
    private val listener: Listener
) {
    interface Listener {
        fun onStatus(message: String, connections: Int)
        fun onAdvertisingFailed(message: String)
        fun onConnected(installationId: String)
        fun onTransfer(installationId: String)
        fun onSaved(installationId: String, accepted: Int, rejected: Int)
        fun onFailure(installationId: String?, duringTransfer: Boolean)
        fun onDisconnected(installationId: String)
    }

    private val connections = Nearby.getConnectionsClient(activity)
    private val worker = Executors.newSingleThreadExecutor()
    private val challenges = ConcurrentHashMap<String, String>()
    private val endpointInstallations = ConcurrentHashMap<String, String>()
    private val manualAttempts = ConcurrentHashMap<String, Int>()
    @Volatile
    private var running = false
    private var generation = 0

    private val payloadCallback = object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {
            if (payload.type != Payload.Type.BYTES) return
            val bytes = payload.asBytes() ?: return
            if (bytes.size > 180_000) {
                connections.disconnectFromEndpoint(endpointId)
                return
            }
            val challenge = challenges[endpointId] ?: return
            worker.execute {
                if (!running || challenges[endpointId] != challenge) return@execute
                var installationId: String? = endpointInstallations[endpointId]
                var duringTransfer = false
                try {
                    val envelope = JSONObject(String(bytes, Charsets.UTF_8))
                    require(envelope.getInt("v") == 1)
                    val kind = envelope.getString("type")
                    duringTransfer = kind == "batch"
                    if (kind == "manual_enroll") {
                        require(bytes.size <= 2048)
                        val attempts = manualAttempts.merge(endpointId, 1, Int::plus) ?: 1
                        require(attempts <= 3)
                        val response = manualEnrollment.respond(
                            identity.classId, challenge, envelope, identity.qrPayload()
                        )
                        if (running && challenges[endpointId] == challenge)
                            connections.sendPayload(endpointId, Payload.fromBytes(response.toString().toByteArray()))
                        return@execute
                    }
                    require(kind == "intro" || kind == "batch")
                    val sessionKey = identity.unwrapSessionKey(envelope.getString("wrapped_key"))
                    val batch = JSONObject(identity.decrypt(sessionKey, challenge, envelope))
                    require(batch.getString("challenge") == challenge && batch.toString().length <= 150_000)
                    val receivedInstallationId = batch.getString("installation_id")
                    installationId = receivedInstallationId
                    val earlierInstallationId = endpointInstallations[endpointId]
                    require(earlierInstallationId == null || earlierInstallationId == receivedInstallationId)
                    if (kind == "intro") require(batch.getJSONArray("events").length() == 0)
                    else activity.runOnUiThread {
                        if (running && challenges[endpointId] == challenge) listener.onTransfer(receivedInstallationId)
                    }
                    val result = database.ingest(identity.classId, batch, kind == "batch")
                    if (result.accepted.isNotEmpty()) runCatching { ActivityUploader.schedule(activity) }
                    endpointInstallations[endpointId] = receivedInstallationId
                    val response = JSONObject()
                        .put("challenge", challenge)
                        .put("accepted", JSONArray(result.accepted))
                        .put("rejected", JSONArray(result.rejected))
                    val ack = identity.encrypt(
                        sessionKey, challenge, response.toString(), if (kind == "intro") "ready" else "ack"
                    )
                    if (!running || challenges[endpointId] != challenge) return@execute
                    connections.sendPayload(endpointId, Payload.fromBytes(ack.toString().toByteArray()))
                    activity.runOnUiThread {
                        if (!running || challenges[endpointId] != challenge) return@runOnUiThread
                        if (kind == "intro") listener.onConnected(receivedInstallationId)
                        else listener.onSaved(receivedInstallationId, result.accepted.size, result.rejected.size)
                    }
                } catch (_: Exception) {
                    activity.runOnUiThread {
                        if (running && challenges[endpointId] == challenge)
                            listener.onFailure(installationId, duringTransfer)
                    }
                    connections.disconnectFromEndpoint(endpointId)
                }
            }
        }

        override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) = Unit
    }

    private val connectionCallback = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
            if (running) {
                listener.onStatus("Student connecting…", challenges.size)
                connections.acceptConnection(endpointId, payloadCallback)
            }
            else connections.rejectConnection(endpointId)
        }

        override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
            if (!running) return
            if (!result.status.isSuccess) {
                listener.onStatus("Student connection failed; retry in Hiraia.", challenges.size)
                return
            }
            val challenge = ClassIdentity.challenge()
            challenges[endpointId] = challenge
            val hello = JSONObject().put("v", 1).put("type", "challenge").put("challenge", challenge)
            connections.sendPayload(endpointId, Payload.fromBytes(hello.toString().toByteArray()))
            listener.onStatus("Collecting class activity", challenges.size)
        }

        override fun onDisconnected(endpointId: String) {
            challenges.remove(endpointId)
            manualAttempts.remove(endpointId)
            endpointInstallations.remove(endpointId)?.let { listener.onDisconnected(it) }
            if (running) listener.onStatus("Collecting class activity", challenges.size)
        }
    }

    fun start() {
        if (running) return
        running = true
        val startedGeneration = ++generation
        listener.onStatus("Starting Nearby…", 0)
        val options = AdvertisingOptions.Builder().setStrategy(Strategy.P2P_STAR).build()
        connections.startAdvertising("Hiraia Tala", SERVICE_ID, connectionCallback, options)
            .addOnSuccessListener {
                if (running && generation == startedGeneration)
                    listener.onStatus("Nearby ready · Waiting for student phones", challenges.size)
            }
            .addOnFailureListener { error ->
                if (running && generation == startedGeneration) {
                    running = false
                    val code = (error as? ApiException)?.statusCode?.toString() ?: "unknown"
                    listener.onAdvertisingFailed(
                        "Nearby could not start (code $code). Check Bluetooth and Nearby permissions, then retry."
                    )
                }
            }
    }

    fun stop() {
        running = false
        generation++
        connections.stopAdvertising()
        connections.stopAllEndpoints()
        challenges.clear()
        manualAttempts.clear()
        endpointInstallations.clear()
        listener.onStatus("Collection paused", 0)
    }

    fun close() {
        stop()
        worker.shutdown()
    }

    companion object {
        const val SERVICE_ID = "com.hiraia.classroom.v1"
    }
}
