# Resolution Guide: Google AI Studio Daily Quota Limits & Gemini Enterprise Agent Platform Setup

This guide explains how to bypass the daily 70-request limit by switching to the **Gemini Enterprise Agent Platform (formerly Vertex AI) API**, utilizing your existing Google Cloud billing credit of **$106.73**.

---

> [!NOTE]
> **Rebrand Update (April 2026):** Google has officially rebranded **Vertex AI** as the **Gemini Enterprise Agent Platform** (also referred to as **Gemini Enterprise**). While UI names in the Google Cloud Console have updated, the underlying API endpoints and IAM roles still use the legacy `aiplatform` naming and remain fully compatible.

---

## Option A: Immediate Bypass via Gemini Enterprise / Vertex AI (Recommended)
Because you have a **$106.73 credit** on your Google Cloud Billing Account, you can enable and use the **Gemini Enterprise / Vertex AI API** in your project immediately. This platform has no daily 70-image caps; instead, it uses Requests Per Minute (RPM) limits (usually 5 RPM or higher), allowing us to generate all 2,616 remaining images in a few hours.

### Step 1: Enable the API
1. Open the [Google Cloud Console API Library for Vertex AI / Gemini Enterprise API](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com).
2. Ensure you have the **Default Gemini Project** (or your active project) selected in the top project dropdown.
3. Click the blue **Enable** button to enable the **Vertex AI API** (`aiplatform.googleapis.com`). *(Note: The underlying API service name remains `aiplatform.googleapis.com` under the hood).*

### Step 2: Create a Service Account and Key
To authorize the script to make calls on behalf of your Google Cloud Project:
1. Navigate to the [IAM & Admin Service Accounts page](https://console.cloud.google.com/iam-admin/serviceaccounts).
2. Click **Create Service Account** at the top.
3. Name it `image-generator` and click **Create and Continue**.
4. In the role dropdown, select **Vertex AI > Vertex AI User** (or search for **Vertex AI User** / `roles/aiplatform.user`). Click **Continue**, then click **Done**.
5. Find your new service account in the list, click the three vertical dots (actions) on the far right, and select **Manage keys**.
6. Click **Add Key > Create new key**. Select **JSON**, then click **Create**.
7. A JSON file will automatically download to your computer.

### Step 3: Place the Key in the Project
1. Rename the downloaded JSON file to **`credentials.json`**.
2. Save it directly inside:
   `/Users/luis/Code/hiraia-retrieval/packages/images/gemini-queue/credentials.json`
   *(This folder has been configured via `.gitignore` to keep your credentials secure).*

---

## Option B: Wait to Upgrade Google AI Studio to Tier 2
If you prefer not to use a Service Account and instead wait for your Google AI Studio project to upgrade to Tier 2:
1. **Prepay Spend:** You must have spent/billed at least **$100** on your billing account since account creation.
2. **Age Threshold:** At least **3 days** must pass since your first successful payment (which was made on June 3).
3. **Check Status:** Once both criteria are met, Google AI Studio will automatically upgrade you. Check your status under **Settings** or **API Keys** on the [Google AI Studio Console](https://aistudio.google.com/).

---

## Resuming the Batch Image Generation

Once your **`credentials.json`** file is in place (for Option A), or your daily limit resets / Tier 2 is active (for Option B), you can resume the sequential image generator.

Run the following command from the root of `packages/images`:
```bash
node --env-file=gemini-queue/.env gemini-queue/batch-generator.mjs animals --limit 10000 --delay 8000
```

### Parameters:
* `--limit 10000`: Process all remaining todo items in the current topic queue.
* `--delay 8000`: Uses an 8-second delay to safely stay below the **10 Requests Per Minute (RPM)** rate limit.
* **Auto-Detection:** The script will print `Using Gemini Enterprise / Vertex AI Mode (Project: ...)` if it detects `credentials.json`, otherwise it will fallback to using `GEMINI_API_KEY`.

