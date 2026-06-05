import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleAuth } from 'google-auth-library';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');

// Helper to print usage
function printUsage() {
  console.log(`
Usage:
  GEMINI_API_KEY=your_key node batch-generator.mjs <topic_name> [options]

Options:
  --limit <number>   Limit the number of images to generate in this run (default: 5)
  --delay <ms>       Delay between requests in milliseconds (default: 3000)

Examples:
  GEMINI_API_KEY=xxx node batch-generator.mjs animals --limit 10
  GEMINI_API_KEY=xxx node batch-generator.mjs plants
`);
}

// Parse args
const args = process.argv.slice(2);
const topic = args[0];

if (!topic || topic === '--help' || topic === '-h') {
  printUsage();
  process.exit(0);
}

let limit = 5;
let delay = 3000;

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--limit') {
    limit = parseInt(args[++i], 10);
  } else if (args[i] === '--delay') {
    delay = parseInt(args[++i], 10);
  }
}

// Check credentials / select backend mode
let auth;
let isVertex = false;
let projectId = '';
const location = process.env.GCP_LOCATION || 'us-central1';

const credentialsPath = join(HERE, 'credentials.json');
if (existsSync(credentialsPath)) {
  try {
    const creds = JSON.parse(readFileSync(credentialsPath, 'utf8'));
    projectId = creds.project_id || process.env.GCP_PROJECT_ID;
    auth = new GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    isVertex = true;
    console.log(`Using Gemini Enterprise / Vertex AI Mode (Project: ${projectId}, Location: ${location})`);
  } catch (err) {
    console.error('Error loading credentials.json:', err.message);
  }
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  isVertex = true;
  try {
    projectId = await auth.getProjectId();
  } catch {}
  console.log(`Using Gemini Enterprise / Vertex AI Mode via ADC (Project: ${projectId || 'default'}, Location: ${location})`);
}

const apiKey = process.env.GEMINI_API_KEY;
if (!isVertex && !apiKey) {
  console.error('Error: Either gemini-queue/credentials.json must exist (for Gemini Enterprise / Vertex AI) or GEMINI_API_KEY environment variable is required.');
  printUsage();
  process.exit(1);
}

const promptFile = join(HERE, 'prompts', `${topic}.json`);
if (!existsSync(promptFile)) {
  console.error(`Error: Prompt file not found: ${promptFile}`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(promptFile, 'utf8'));
const todoItems = data.images.filter(img => img.status === 'todo');

if (todoItems.length === 0) {
  console.log(`All images in topic "${topic}" are already done!`);
  process.exit(0);
}

console.log(`Found ${todoItems.length} todo images in "${topic}". Will process up to ${limit} in this run.`);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

for (let i = 0; i < Math.min(limit, todoItems.length); i++) {
  const item = todoItems[i];
  console.log(`\n[${i + 1}/${limit}] Generating "${item.id}"...`);
  console.log(`Prompt: "${item.prompt.substring(0, 100)}..."`);

    let refPath = join(HERE, 'references', `${item.id}.png`);
    if (!existsSync(refPath)) {
      refPath = join(HERE, 'references', `${item.id}.jpg`);
    }
    if (!existsSync(refPath)) {
      refPath = join(HERE, 'references', `${item.id}.jpeg`);
    }
    let hasRef = false;
    let base64Ref = '';
    if (existsSync(refPath)) {
      try {
        base64Ref = readFileSync(refPath).toString('base64');
        hasRef = true;
        console.log(`[REFERENCE] Found reference image for ${item.id} (${refPath.split('.').pop()}), enabling Canny edge Controlled Customization.`);
      } catch (err) {
        console.error(`Failed to read reference image for ${item.id}:`, err.message);
      }
    }

    try {
      let url;
    const headers = {
      'Content-Type': 'application/json',
    };
    let body;

    if (isVertex) {
      const client = await auth.getClient();
      const tokenResponse = await client.getAccessToken();
      const accessToken = tokenResponse.token;
      
      url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/imagen-4.0-fast-generate-001:predict`;
      headers['Authorization'] = `Bearer ${accessToken}`;
      
      const instances = [
        {
          prompt: item.prompt,
        },
      ];
      const parameters = {
        sampleCount: 1,
        aspectRatio: '1:1',
        outputMimeType: 'image/png',
      };
      
      if (hasRef) {
        instances[0].controlImage = {
          bytesBase64Encoded: base64Ref,
        };
        parameters.controlType = 'CONTROL_TYPE_CANNY';
        parameters.enableControlImageComputation = true;
      }

      body = JSON.stringify({ instances, parameters });
    } else {
      url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-fast-generate-001:predict?key=${apiKey}`;
      
      const instances = [
        {
          prompt: item.prompt,
        },
      ];
      const parameters = {
        sampleCount: 1,
        aspectRatio: '1:1',
        outputOptions: {
          mimeType: 'image/png',
        },
      };

      if (hasRef) {
        instances[0].controlImage = {
          bytesBase64Encoded: base64Ref,
        };
        parameters.controlType = 'CONTROL_TYPE_CANNY';
        parameters.enableControlImageComputation = true;
      }

      body = JSON.stringify({ instances, parameters });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API returned status ${response.status}: ${errorText}`);
    }

    const resJson = await response.json();
    if (!resJson.predictions || resJson.predictions.length === 0) {
      throw new Error(`API response did not contain predictions: ${JSON.stringify(resJson)}`);
    }

    const base64Data = resJson.predictions[0].bytesBase64Encoded;
    if (!base64Data) {
      throw new Error('API prediction did not contain base64 bytes.');
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const destPath = join(PKG, item.output_png);

    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, buffer);

    console.log(`Success! Saved to ${item.output_png}`);

    // Update status in JSON memory
    const originalIndex = data.images.findIndex(img => img.id === item.id);
    if (originalIndex !== -1) {
      data.images[originalIndex].status = 'done';
    }

    // Write progress back to the file
    writeFileSync(promptFile, JSON.stringify(data, null, 2), 'utf8');

  } catch (err) {
    console.error(`Failed to generate "${item.id}":`, err.message);
    if (err.message.includes('status 429') || err.message.includes('429')) {
      console.log('Exiting batch run due to rate limit (429)...');
      process.exit(429);
    }
    // Update status in JSON memory
    const originalIndex = data.images.findIndex(img => img.id === item.id);
    if (originalIndex !== -1) {
      const isSafetyBlock = err.message.includes('predictions') || err.message.includes('status 400') || err.message.includes('safety');
      data.images[originalIndex].status = isSafetyBlock ? 'skipped' : 'failed';
      console.log(`Marked "${item.id}" as ${data.images[originalIndex].status}`);
    }
    // Write progress back to the file
    writeFileSync(promptFile, JSON.stringify(data, null, 2), 'utf8');
  }

  if (i < limit - 1 && i < todoItems.length - 1) {
    console.log(`Waiting ${delay}ms before next image...`);
    await sleep(delay);
  }
}

console.log('\nBatch run complete!');
