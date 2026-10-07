package com.hiraia.provisioner

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.Context
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.InterruptedIOException
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * The provisioning steps. Every step is safe to repeat: a job that is stopped part-way, or a
 * phone that reboots, simply runs them again. [stopped] turns true when JobScheduler stops the
 * job; from then on nothing is written, so a stale run cannot undo what its successor did.
 */
class Provisioner(private val context: Context, private val stopped: () -> Boolean = { false }) {
    private val state = ProvisioningState(context)
    private val dpm = context.getSystemService(DevicePolicyManager::class.java)
    private val admin = AdminReceiver.component(context)
    private val locator = ServerLocator(context, state, stopped)
    private val version = context.packageManager.getPackageInfo(context.packageName, 0)
    private val hiraia = HiraiaInstall(context, state, stopped)

    enum class Outcome { DONE, RETRY }

    /**
     * Registers this phone, installs Hiraia from the server if it offers it, and reports the phone
     * set up. RETRY while the server cannot be reached or a download is still under way.
     */
    fun provision(): Outcome = lock.withLock { provisionLocked() }

    private fun provisionLocked(): Outcome {
        if (!dpm.isDeviceOwnerApp(context.packageName)) {
            return fail("This app is not the device owner, so it cannot set the phone up")
        }
        if (!state.configured) return fail("The QR code did not name a provisioning server")
        if (!ServerClient.onWifi(context)) return waiting("Waiting for Wi-Fi")
        val granted = try {
            dpm.setPermissionGrantState(admin, context.packageName, Manifest.permission.READ_PHONE_STATE,
                DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)
        } catch (failure: RuntimeException) {
            if (failure.cause is InterruptedException) return Outcome.RETRY // stopped while waiting
            false
        }
        return try {
            if (state.secret == null) {
                register()
                if (state.status != ProvisioningState.Status.COMPLETE) state.record(ProvisioningState.Status.REGISTERED)
            }
            refreshLockScreen()
            val notes = mutableListOf<String>()
            if (!granted) notes += "Could not read the IMEI: permission refused"
            val offers = offers(ProvisioningState.Status.INSTALLING)
            // A newer Hiraia Setup comes first: it may be the fix for whatever stopped this phone,
            // and a phone that is not yet set up would otherwise never take one.
            if (newerDpc(offers)) {
                update(offers.getJSONObject("dpc"))
                return Outcome.RETRY // the new build carries on from MY_PACKAGE_REPLACED
            }
            notes += setUpHiraia(offers, finished = false)
            notes += DeviceSetup(context, state, stopped).apply()
            if (stopped()) return Outcome.RETRY
            report(ProvisioningState.Status.COMPLETE, notes.joinToString("; "))
            state.record(ProvisioningState.Status.COMPLETE, notes.joinToString("; "))
            refreshLockScreen()
            Jobs.scheduleCheckIns(context)
            Outcome.DONE
        } catch (refused: ServerClient.Refused) {
            fail(refused.message ?: "The server refused this phone")
        } catch (refused: HiraiaInstall.Refused) {
            fail(refused.message ?: "Hiraia could not be installed")
        } catch (unreachable: IOException) {
            if (stopped()) Outcome.RETRY
            else waiting("Cannot reach the provisioning server: ${unreachable.message ?: unreachable.javaClass.simpleName}")
        } catch (malformed: JSONException) {
            fail("The server's reply was not understood (${malformed.message})")
        }
    }

    /**
     * Once set up, tells the server the phone is still here and takes a newer DPC if it has one.
     * When the server is not around, which after the warehouse is the normal case, it only applies
     * the package policy again, quietly.
     */
    fun checkIn() = lock.withLock { checkInLocked() }

    private fun checkInLocked(): Outcome {
        if (!dpm.isDeviceOwnerApp(context.packageName)) return Outcome.DONE
        if (state.status != ProvisioningState.Status.COMPLETE) {
            Jobs.provision(context) // not finished: that is provisioning's job, not the check-in's
            return Outcome.DONE
        }
        val setup = DeviceSetup(context, state, stopped)
        if (!ServerClient.onWifi(context)) {
            applyPolicyAlone(setup)
            return if (state.retryCheckIn()) Outcome.RETRY else Outcome.DONE
        }
        try {
            val offers = offers(ProvisioningState.Status.COMPLETE)
            state.checkedIn(System.currentTimeMillis())
            // Update management first. A busy APK transfer must not prevent the DPC
            // from receiving the fix for its own scheduling/retry behavior.
            if (newerDpc(offers)) {
                state.beginCheckInRetryWindow()
                update(offers.getJSONObject("dpc"))
                return Outcome.RETRY // MY_PACKAGE_REPLACED schedules the new build
            }
            val apk = offers.optJSONObject("hiraia")
            if (apk != null && (hiraia.installedVersion() ?: 0) < apk.getLong("version_code")) {
                state.beginCheckInRetryWindow()
            }
            val notes = setUpHiraia(offers, finished = true) + setup.apply()
            if (notes.isNotEmpty() && !stopped()) state.note(notes.joinToString("; "))
            if (!stopped()) state.clearCheckInRetryWindow()
        } catch (refused: HiraiaInstall.Refused) {
            if (!stopped()) {
                state.clearCheckInRetryWindow()
                state.note(refused.message ?: "Hiraia could not be updated")
                runCatching { report(ProvisioningState.Status.ERROR, (refused.message ?: "").take(500)) }
            }
        } catch (refused: ServerClient.Refused) {
            // The server is there but will not take this phone: say so on the status screen,
            // rather than looking like a phone that is simply away from the warehouse.
            if (!stopped()) {
                state.clearCheckInRetryWindow()
                state.note("Check-in refused: ${refused.message}")
            }
        } catch (_: IOException) {
            // Busy slots, interrupted downloads and boot-before-Wi-Fi retry through
            // JobScheduler. A laptop absent past the bounded window returns to the
            // normal two-hour schedule instead of burning battery indefinitely.
            if (!stopped()) applyPolicyAlone(setup)
            return if (stopped() || state.retryCheckIn()) Outcome.RETRY else Outcome.DONE
        } catch (problem: JSONException) {
            state.clearCheckInRetryWindow()
            state.note("Check-in failed: the server's reply was not understood (${problem.message})")
        }
        return if (stopped()) Outcome.RETRY else Outcome.DONE
    }

    /** Away from the server: only the package policy, which needs none (see DeviceSetup). */
    private fun applyPolicyAlone(setup: DeviceSetup) {
        val notes = try {
            setup.applyPackagePolicy()
        } catch (_: InterruptedIOException) {
            return // stopped: the next check-in runs it again
        }
        if (notes.isNotEmpty() && !stopped()) state.note(notes.joinToString("; "))
    }

    /** A newer Hiraia Setup is on offer, and Android has not already been handed it twice. */
    private fun newerDpc(offers: JSONObject): Boolean {
        val offered = offers.optJSONObject("dpc")?.optLong("version_code") ?: return false
        return !stopped() && wantsDpcUpdate(offered, version.longVersionCode, state.dpcUpdateTries(offered))
    }

    /** What the server offers now: Hiraia, the content mirror and this DPC. Also a check-in. */
    private fun offers(status: ProvisioningState.Status): JSONObject = withDevice { client, auth ->
        client.post("/api/checkin", JSONObject()
            .put("status", status.name)
            .put("dpc_version_code", version.longVersionCode)
            .put("dpc_version", version.versionName), auth)
    }

    /**
     * Installs or updates Hiraia when the server offers a newer one, then grants its permissions and
     * points it at the mirror. A server that offers no Hiraia (or an older one) changes nothing.
     * Returns notes for the operator. [finished]: the phone is already set up, so its status stays.
     */
    private fun setUpHiraia(offers: JSONObject, finished: Boolean): List<String> {
        val offer = offers.optJSONObject("hiraia")
        if (offer != null && (hiraia.installedVersion() ?: 0) < offer.getLong("version_code")) {
            if (!finished) state.record(ProvisioningState.Status.INSTALLING)
            hiraia.ensure(offer, download = { partial, size, onBytes ->
                withDevice { client, auth ->
                    client.resume("/api/hiraia.apk", auth, partial, size, stopped, onBytes)
                }
            }, progress = { step ->
                state.note(step)
                runCatching { report(ProvisioningState.Status.INSTALLING, step) }
            })
            if (finished) {
                state.note("") // the progress notes are over; a set-up phone reads as set up again
                runCatching { report(ProvisioningState.Status.COMPLETE, "") }
            }
        }
        if (hiraia.installedVersion() == null) return emptyList()
        val mirror = offers.optString("mirror").takeIf { offers.has("mirror") && !offers.isNull("mirror") }
        val refused = hiraia.configure(mirror)
        return if (refused.isEmpty()) emptyList() else listOf("Android would not grant Hiraia: ${refused.joinToString()}")
    }

    private fun register() {
        val reply = locator.call {
            it.post("/api/register", DeviceInventory.collect(context, state), ServerClient.Auth.token(state.token!!))
        }
        state.registered(reply.getString("hiraia_id"), reply.getString("secret"), reply.getString("receipt"))
    }

    private fun report(status: ProvisioningState.Status, detail: String) {
        withDevice { client, auth ->
            client.post("/api/report", JSONObject().put("status", status.name).put("detail", detail), auth)
        }
    }

    /**
     * Runs a request as this phone. A 401 means the server has lost track of it (its database was
     * restored, say): register again, showing the ID and receipt it holds, and retry once. That
     * never changes the phone's own progress: a set-up phone stays set up.
     */
    private fun <T> withDevice(request: (ServerClient, ServerClient.Auth) -> T): T {
        repeat(2) { attempt ->
            if (state.secret == null) {
                register()
                refreshLockScreen()
            }
            val auth = ServerClient.Auth.device(state.hiraiaId!!, state.secret!!)
            try {
                return locator.call { request(it, auth) }
            } catch (refused: ServerClient.Refused) {
                if (refused.code != 401 || attempt > 0) throw refused
                state.forgetSecret()
            }
        }
        error("unreachable")
    }

    private fun update(offer: JSONObject) {
        context.cacheDir.listFiles { file -> file.name.startsWith("dpc-") }?.forEach { it.delete() }
        val apk = File.createTempFile("dpc-", ".apk", context.cacheDir)
        try {
            withDevice { client, auth ->
                client.download("/api/dpc.apk", auth, apk, offer.getString("sha256"), offer.getLong("size"))
            }
            if (stopped()) return
            // Counted here, not before the download: a dropped download is no reason to give up
            // on a version, and only an install Android keeps refusing should stop the retries.
            val versionCode = offer.getLong("version_code")
            state.dpcUpdateTried(versionCode)
            state.note("Installing Hiraia Setup $versionCode")
            PackageInstall.install(context, apk, context.packageName)
        } finally {
            apk.delete() // the installer session holds its own copy
        }
    }

    private fun waiting(reason: String): Outcome {
        if (!stopped()) state.record(ProvisioningState.Status.WAITING_FOR_SERVER, reason)
        return Outcome.RETRY
    }

    private fun fail(reason: String): Outcome {
        if (stopped()) return Outcome.RETRY
        state.record(ProvisioningState.Status.ERROR, reason)
        refreshLockScreen()
        // Best effort, so the dashboard shows the failure too. A phone that never registered is
        // not on the dashboard; the server's terminal logs the refusal instead.
        if (state.secret != null) runCatching { report(ProvisioningState.Status.ERROR, reason.take(500)) }
        return Outcome.DONE
    }

    /** What the lock screen says, so a phone can be picked out of a pile without unlocking it. */
    private fun refreshLockScreen() {
        val progress = when (state.status) {
            ProvisioningState.Status.COMPLETE -> null
            ProvisioningState.Status.ERROR -> "setup stopped"
            else -> "setting up"
        }
        val id = state.hiraiaId
        val text = listOfNotNull(if (id == null) "Hiraia" else "Hiraia $id", progress).joinToString(" · ")
        runCatching {
            dpm.setOrganizationName(admin, "Hiraia")
            dpm.setDeviceOwnerLockScreenInfo(admin, text)
        }
    }

    companion object {
        /** One run at a time in this process: a stopped run finishing late must not interleave with its successor. */
        private val lock = ReentrantLock()

        /** Installs of one offered DPC version Android may refuse before this phone stops asking. */
        const val DPC_INSTALL_ATTEMPTS = 2

        /** Whether to install [offered], given the running version and the installs already tried. */
        fun wantsDpcUpdate(offered: Long, running: Long, tries: Int) = offered > running && tries < DPC_INSTALL_ATTEMPTS
    }
}
