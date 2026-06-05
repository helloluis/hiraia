import { GoogleAuth } from 'google-auth-library';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const credentialsPath = join(HERE, 'credentials.json');
const location = 'us-central1';

async function main() {
  console.log('Starting Hiraia Image Quality Control...');
  
  // 1. Setup Auth
  if (!existsSync(credentialsPath)) {
    console.error(`Credentials file not found at ${credentialsPath}`);
    process.exit(1);
  }
  
  const auth = new GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  
  const client = await auth.getClient();
  const projectId = await auth.getProjectId();
  
  let accessToken;
  let tokenExpiry = 0;
  
  async function refreshAccessToken() {
    console.log('Acquiring fresh access token...');
    const tokenResponse = await client.getAccessToken();
    accessToken = tokenResponse.token;
    // Expire slightly early to be safe
    tokenExpiry = Date.now() + 50 * 60 * 1000; 
  }
  
  await refreshAccessToken();
  
  // 2. Load Prompt Database
  const promptsDir = join(HERE, 'prompts');
  const promptFiles = readdirSync(promptsDir).filter(f => f.endsWith('.json'));
  
  const promptMap = new Map();
  for (const file of promptFiles) {
    const data = JSON.parse(readFileSync(join(promptsDir, file), 'utf8'));
    for (const img of data.images) {
      promptMap.set(img.id, img);
    }
  }
  console.log(`Loaded ${promptMap.size} prompt definitions from ${promptFiles.length} files.`);
  
  // 3. Scan assets-png Directory
  const assetsDir = join(PKG, 'assets-png');
  if (!existsSync(assetsDir)) {
    console.error(`Assets directory not found at ${assetsDir}`);
    process.exit(1);
  }
  
  const subjects = ['biology', 'chemistry', 'earth-science', 'general', 'physics'];
  const imageFiles = [];
  
  for (const sub of subjects) {
    const dir = join(assetsDir, sub);
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter(f => f.endsWith('.png'));
      for (const file of files) {
        const id = file.substring(0, file.length - 4); // strip .png
        imageFiles.push({
          id,
          subject: sub,
          fileName: file,
          relPath: join('assets-png', sub, file),
          absPath: join(dir, file)
        });
      }
    }
  }
  
  console.log(`Found ${imageFiles.length} rendered images in assets-png.`);
  
  // 4. Load or Initialize QC Progress
  const progressPath = join(HERE, 'qc-progress.json');
  let qcProgress = {};
  if (existsSync(progressPath)) {
    try {
      qcProgress = JSON.parse(readFileSync(progressPath, 'utf8'));
      console.log(`Loaded existing progress with ${Object.keys(qcProgress).length} evaluated images.`);
    } catch (e) {
      console.warn('Could not parse qc-progress.json, starting fresh.', e.message);
    }
  }
  
  // 5. Ensure Flagged Directory exists
  const flaggedDir = join(assetsDir, 'flagged');
  if (!existsSync(flaggedDir)) {
    mkdirSync(flaggedDir, { recursive: true });
    console.log(`Created flagged directory at ${flaggedDir}`);
  }
  
  // 6. Define API call with retry and backoff
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/gemini-2.5-flash:generateContent`;
  
  async function evaluateImage(item, imgBase64, attempt = 1) {
    if (Date.now() > tokenExpiry) {
      await refreshAccessToken();
    }
    
    const evalPrompt = `
You are an expert educational illustration reviewer. Your task is to evaluate whether a generated illustration conforms to the required project style and represents the requested concept prompt correctly.

REQUIRED HOUSE STYLE SPECIFICATIONS:
1. Style: Hand-drawn black-and-white line art, as if sketched by a clever child with a thick black marker.
2. Background: Must be a flat, plain, solid white background. No background scenery, color fills, patterns, or gradients unless explicitly requested in the prompt.
3. No Color: The image must be strictly black-and-white. It should contain only black lines and loose black scribble shading. There must be no colors (like red, blue, green, etc.), and no solid gray fills or smooth gray gradients.
4. No Text: There must be absolutely NO text, letters, numbers, words, labels, signatures, or captions in the image.
5. Content Accuracy: The illustration must accurately and clearly depict the subject and concept described in the prompt.

CONCEPT PROMPT:
"${item.prompt}"

Evaluate this image and reply with a JSON object matching this schema:
{
  "needs_remake": true/false,
  "reasons": ["list of reasons if needs_remake is true, otherwise empty"]
}

Be strict about:
- Text: Flag any image containing letters, numbers, or labels.
- Color: Flag any image containing color.
- Style: Flag images that look like photos, detailed 3D renders, or digital cartoon drawings with solid gray/color fills (must be black line art with scribble shading).
- Off-topic: Flag if the illustration does not match the prompt concept.

Do not wrap the output in markdown code blocks. Reply with raw JSON.
`;

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    };
    
    const body = JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: evalPrompt },
            {
              inlineData: {
                mimeType: 'image/png',
                data: imgBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        maxOutputTokens: 1000,
        temperature: 0.1,
        responseMimeType: 'application/json',
        thinkingConfig: {
          thinkingBudget: 0
        }
      }
    });
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(20000)
      });
      
      if (response.status === 429) {
        const delay = Math.min(5000 * Math.pow(2, attempt), 60000);
        console.warn(`[429 Rate Limit] Retrying "${item.id}" after ${delay}ms... (Attempt ${attempt})`);
        await new Promise(r => setTimeout(r, delay));
        return evaluateImage(item, imgBase64, attempt + 1);
      }
      
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API returned ${response.status}: ${errText}`);
      }
      
      const json = await response.json();
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error(`Empty response candidates: ${JSON.stringify(json)}`);
      }
      
      const parsed = JSON.parse(text.trim());
      return parsed;
    } catch (err) {
      if (attempt <= 3) {
        const delay = 3000 * attempt;
        console.warn(`[Error] ${err.message}. Retrying "${item.id}" after ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        return evaluateImage(item, imgBase64, attempt + 1);
      }
      throw err;
    }
  }
  
  // 7. Filter items to process
  const pendingFiles = imageFiles.filter(img => !qcProgress[img.id]);
  console.log(`Processing ${pendingFiles.length} pending images...`);
  
  const concurrency = 25;
  let activeCount = 0;
  let index = 0;
  let successCount = 0;
  let remakeCount = 0;
  let errorCount = 0;
  
  // Track metrics of already completed evaluations
  for (const id in qcProgress) {
    if (qcProgress[id].needs_remake) remakeCount++;
    else successCount++;
  }
  
  const runNext = async () => {
    if (index >= pendingFiles.length) return;
    
    const fileInfo = pendingFiles[index++];
    activeCount++;
    
    const currentIdx = index;
    const totalPending = pendingFiles.length;
    
    try {
      const promptDef = promptMap.get(fileInfo.id);
      if (!promptDef) {
        console.warn(`[Warning] No prompt definition found for image: ${fileInfo.id}`);
        qcProgress[fileInfo.id] = {
          needs_remake: false,
          reasons: ['No prompt metadata found'],
          timestamp: new Date().toISOString()
        };
        activeCount--;
        runNext();
        return;
      }
      
      const imgBase64 = readFileSync(fileInfo.absPath).toString('base64');
      const result = await evaluateImage(promptDef, imgBase64);
      
      qcProgress[fileInfo.id] = {
        needs_remake: result.needs_remake,
        reasons: result.reasons || [],
        timestamp: new Date().toISOString()
      };
      
      if (result.needs_remake) {
        remakeCount++;
        console.log(`[FLAGGED] [${currentIdx}/${totalPending}] ${fileInfo.id} - Reasons: ${result.reasons.join(', ')}`);
      } else {
        successCount++;
        // Print progress occasionally
        if (currentIdx % 20 === 0 || currentIdx === totalPending) {
          console.log(`[PASS] [${currentIdx}/${totalPending}] ${fileInfo.id}`);
        }
      }
      
      // Write progress incrementally
      writeFileSync(progressPath, JSON.stringify(qcProgress, null, 2), 'utf8');
      
    } catch (err) {
      errorCount++;
      console.error(`[Error] Failed to evaluate ${fileInfo.id}:`, err.message);
    } finally {
      activeCount--;
      runNext();
    }
  };
  
  // Start pool
  const pool = [];
  for (let i = 0; i < Math.min(concurrency, pendingFiles.length); i++) {
    pool.push(runNext());
  }
  await Promise.all(pool);
  
  // Wait a small bit to ensure any trailing promises complete
  while (activeCount > 0) {
    await new Promise(r => setTimeout(r, 100));
  }
  
  // 8. Create Flagged Symlinks
  console.log('\nUpdating flagged symlinks in assets-png/flagged...');
  
  // Get all currently flagged images
  const flaggedIds = new Set();
  for (const id in qcProgress) {
    if (qcProgress[id].needs_remake) {
      flaggedIds.add(id);
    }
  }
  
  // Read existing files/symlinks in assets-png/flagged
  const existingFlaggedFiles = readdirSync(flaggedDir);
  for (const f of existingFlaggedFiles) {
    if (f.endsWith('.png')) {
      const id = f.substring(0, f.length - 4);
      // If it is NOT in the flagged list anymore, delete the symlink!
      if (!flaggedIds.has(id)) {
        console.log(`Removing symlink/file for unflagged image: ${f}`);
        try {
          unlinkSync(join(flaggedDir, f));
        } catch (err) {
          console.error(`Failed to delete ${f}:`, err.message);
        }
      }
    }
  }
  
  // Create missing symlinks
  for (const fileInfo of imageFiles) {
    if (flaggedIds.has(fileInfo.id)) {
      const symlinkPath = join(flaggedDir, fileInfo.fileName);
      if (!existsSync(symlinkPath)) {
        const targetRel = join('..', fileInfo.subject, fileInfo.fileName);
        console.log(`Creating symlink: ${fileInfo.fileName} -> ${targetRel}`);
        try {
          symlinkSync(targetRel, symlinkPath);
        } catch (err) {
          console.error(`Failed to create symlink for ${fileInfo.fileName}:`, err.message);
        }
      }
    }
  }
  
  console.log('\nQuality Control Run Finished!');
  console.log(`Total checked: ${imageFiles.length}`);
  console.log(`Passed: ${successCount}`);
  console.log(`Flagged: ${remakeCount}`);
  console.log(`Errors: ${errorCount}`);
}

main().catch(err => {
  console.error('Fatal error in main:', err);
  process.exit(1);
});
