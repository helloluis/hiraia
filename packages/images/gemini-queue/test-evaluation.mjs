import { GoogleAuth } from 'google-auth-library';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const credentialsPath = '/Users/luis/Code/hiraia-retrieval/packages/images/gemini-queue/credentials.json';
const location = 'us-central1';

async function test() {
  const auth = new GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  
  const client = await auth.getClient();
  const projectId = await auth.getProjectId();
  const tokenResponse = await client.getAccessToken();
  const accessToken = tokenResponse.token;
  
  // Load prompts database to match images with prompts
  const promptsDir = '/Users/luis/Code/hiraia-retrieval/packages/images/gemini-queue/prompts';
  const promptFiles = readdirSync(promptsDir).filter(f => f.endsWith('.json'));
  
  const promptMap = new Map();
  for (const file of promptFiles) {
    const data = JSON.parse(readFileSync(join(promptsDir, file), 'utf8'));
    for (const img of data.images) {
      if (img.status === 'done') {
        promptMap.set(img.id, img);
      }
    }
  }
  
  console.log(`Loaded ${promptMap.size} completed prompt definitions.`);
  
  // Pick 5 sample completed images
  const sampleIds = Array.from(promptMap.keys()).slice(0, 5);
  console.log('Sampling images:', sampleIds);
  
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/gemini-2.5-flash:generateContent`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };
  
  const evalPrompt = `
You are an expert design quality reviewer. Your job is to check if this generated educational illustration matches the required style and prompt content.

REQUIRED STYLE:
- Style: Hand-drawn black-and-white line art (like sketched with a thick black marker on a plain white background).
- Shading: Dark areas should be loose black scribble shading. There should be NO solid gray/black fills, NO smooth gradients, and NO complex textures.
- Background: Must be plain white and completely uncluttered (no frame, border, background scenery unless requested).
- NO COLOR: Strictly black-and-white. No colors, no gray tones other than lines/scribbles.
- NO TEXT: Strictly NO letters, words, labels, numbers, signatures, or text of any kind. 

Evaluate this image against the desired concept prompt:
PROMPT: "{{PROMPT}}"

Evaluate and reply with a JSON object matching this schema:
{
  "needs_remake": true/false,
  "reasons": ["list of reasons if needs_remake is true, otherwise empty"]
}

Focus strictly on style conformance (black & white line art, no text, no color, plain white bg) and whether it accurately represents the requested prompt.
Do not wrap your output in markdown code blocks. Reply with raw JSON.
`;

  for (const id of sampleIds) {
    const item = promptMap.get(id);
    const imagePath = join('/Users/luis/Code/hiraia-retrieval/packages/images', item.output_png);
    
    if (!existsSync(imagePath)) {
      console.warn(`File not found: ${imagePath}`);
      continue;
    }
    
    console.log(`\nEvaluating: ${id}`);
    console.log(`Prompt: ${item.prompt.substring(0, 100)}...`);
    
    const imgBase64 = readFileSync(imagePath).toString('base64');
    
    const formattedPrompt = evalPrompt.replace('{{PROMPT}}', item.prompt.replace(/"/g, '\\"'));
    const body = JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: formattedPrompt },
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
        maxOutputTokens: 250,
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    });
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(15000),
      });
      const json = await response.json();
      console.log('Result:', json.candidates?.[0]?.content?.parts?.[0]?.text);
    } catch (e) {
      console.error('Error checking image:', e.message);
    }
  }
}

test();
