package com.hiraia.provisioner

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * When provisioning work runs. JobScheduler, not a service with a sleep loop: the system wakes the
 * phone for a job even with the screen off, keeps it awake while the job runs, re-runs it after a
 * reboot, and imposes none of the time limits Android 15 puts on long foreground services.
 *
 * No job asks JobScheduler for a network. Any network constraint means a network that reaches the
 * internet, and a closed warehouse Wi-Fi never does, so the job would never start. The steps look
 * for the Wi-Fi themselves and retry while there is none.
 */
object Jobs {
    const val PROVISION = 1
    const val CHECK_IN = 2
    const val CHECK_IN_NOW = 3

    /** Starts provisioning unless it is already scheduled or running. Safe to call from every entry point. */
    fun provision(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java)
        if (scheduler.getPendingJob(PROVISION) != null) return
        schedule(context, PROVISION)
    }

    /** The Try again button: run now, even if a retry is waiting out its backoff, but never twice. */
    fun provisionNow(context: Context) {
        if (!ProvisioningJob.isRunning(PROVISION)) schedule(context, PROVISION)
    }

    fun scheduleCheckIns(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java)
        if (scheduler.getPendingJob(CHECK_IN) != null) return
        scheduler.schedule(checkIns(context))
    }

    /**
     * After this DPC is updated. JobScheduler keeps an app's persisted jobs across an update, with
     * whatever constraints the OLD build gave them, so every job is rebuilt from this build's
     * definitions. Nothing of the new build is running yet, so replacing stops nothing of ours.
     */
    fun rebuild(context: Context, complete: Boolean) {
        val scheduler = context.getSystemService(JobScheduler::class.java)
        if (complete) {
            scheduler.cancel(PROVISION)
            scheduler.schedule(checkIns(context))
            ProvisioningState(context).beginCheckInRetryWindow()
            schedule(context, CHECK_IN_NOW)
        } else {
            scheduler.cancel(CHECK_IN)
            scheduler.cancel(CHECK_IN_NOW)
            schedule(context, PROVISION)
        }
    }

    private fun checkIns(context: Context) =
        JobInfo.Builder(CHECK_IN, ComponentName(context, ProvisioningJob::class.java))
            .setPeriodic(TimeUnit.HOURS.toMillis(2), TimeUnit.MINUTES.toMillis(30))
            .setPersisted(true)
            .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_LINEAR)
            .build()

    fun checkInNow(context: Context) {
        ProvisioningState(context).beginCheckInRetryWindow()
        if (!ProvisioningJob.isRunning(CHECK_IN) && !ProvisioningJob.isRunning(CHECK_IN_NOW)) schedule(context, CHECK_IN_NOW)
    }

    private fun schedule(context: Context, id: Int) {
        context.getSystemService(JobScheduler::class.java).schedule(
            JobInfo.Builder(id, ComponentName(context, ProvisioningJob::class.java))
                // A job needs one constraint; "no earlier than now" is the one that asks for nothing.
                .setMinimumLatency(0)
                .setPersisted(true)
                // Linear, so a phone that could not reach the server for an hour still retries every
                // few minutes rather than every few hours.
                .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_LINEAR)
                .build())
    }
}

class ProvisioningJob : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        val stopped = AtomicBoolean(false)
        lateinit var run: Run
        val worker = thread(start = false, name = "provisioning-${params.jobId}") {
            val again = try {
                val provisioner = Provisioner(applicationContext) { stopped.get() }
                when (params.jobId) {
                    Jobs.PROVISION -> provisioner.provision() == Provisioner.Outcome.RETRY
                    else -> provisioner.checkIn() == Provisioner.Outcome.RETRY
                }
            } catch (_: InterruptedException) {
                true
            } catch (unexpected: Throwable) {
                // Never let a surprise kill the process mid-setup: record it, and retry provisioning.
                runCatching { ProvisioningState(applicationContext).note("Hiraia Setup hit an error: $unexpected") }
                params.jobId == Jobs.PROVISION
            }
            // Only the run JobScheduler still considers current may finish the job. A run stopped by
            // onStopJob has been replaced; finishing for it would end its successor.
            if (running.remove(params.jobId, run)) jobFinished(params, again)
        }
        run = Run(worker, stopped)
        running[params.jobId] = run
        worker.start()
        return true
    }

    /** The job was stopped (or replaced). Every step is safe to repeat, so run it again later. */
    override fun onStopJob(params: JobParameters): Boolean {
        running.remove(params.jobId)?.let {
            it.stopped.set(true)
            it.thread.interrupt()
        }
        return true
    }

    private class Run(val thread: Thread, val stopped: AtomicBoolean)

    companion object {
        private val running = ConcurrentHashMap<Int, Run>()

        fun isRunning(id: Int) = running.containsKey(id)
    }
}

/** A new DPC build carries on where the old one stopped: provisioning, or the check-ins after it. */
class PackageReplacedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        Jobs.rebuild(context, ProvisioningState(context).status == ProvisioningState.Status.COMPLETE)
    }
}

/** Schedule work after unlock/boot; never download from the broadcast receiver itself. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val state = ProvisioningState(context)
        if (!state.configured || !context.getSystemService(android.app.admin.DevicePolicyManager::class.java)
                .isDeviceOwnerApp(context.packageName)) return
        Jobs.rebuild(context, state.status == ProvisioningState.Status.COMPLETE)
    }
}
