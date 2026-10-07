package com.hiraia.provisioner

import android.app.Activity
import android.os.Bundle

/**
 * Setup's last call to the DPC before it finishes. It must return promptly, so the real work
 * (registering, and later installing Hiraia) is scheduled as a job rather than done here.
 */
class PolicyComplianceActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ProvisioningState(this).adopt(ProvisioningState.extras(intent))
        Jobs.provision(this)
        setResult(RESULT_OK)
        finish()
    }
}
