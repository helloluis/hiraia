import { MODEL_INFO } from '@/config/model';

// Local message shape (kept self-contained so the client bundle has zero
// dependency on the @hiraia/shared workspace, which transitively resolves into
// @qvac/sdk's bare-runtime browser shims and crashes hydration).
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: Date;
}

export interface ChatOptions {
  /**
   * Per-request LoRA scales (llama.cpp server `lora` field): one entry per
   * server-loaded adapter, e.g. [{id:0,scale:1}, {id:1,scale:0}]. Omit for base.
   */
  lora?: Array<{ id: number; scale: number }>;
}

/**
 * RemoteEngine - Connects to QVAC's OpenAI-compatible HTTP API.
 * Used by the web demo to talk to a remote QVAC/llama.cpp server. It is a
 * thin chat client (no on-device visuals/embeddings/RAG), so it does not
 * implement the full TutorEngine interface.
 */
export class RemoteEngine {
  private baseUrl: string;
  private isReady: boolean = false;

  constructor(baseUrl: string = 'http://localhost:8080') {
    this.baseUrl = baseUrl;
  }

  async initialize(): Promise<void> {
    try {
      // Test connection to QVAC server
      const response = await fetch(`${this.baseUrl}/v1/models`);
      if (!response.ok) {
        throw new Error(`QVAC server not responding: ${response.statusText}`);
      }
      this.isReady = true;
      console.log('✓ Connected to QVAC server');
    } catch (error) {
      console.error('Failed to connect to QVAC server:', error);
      throw error;
    }
  }

  getReady(): boolean {
    return this.isReady;
  }

  async *chat(messages: Message[], options: ChatOptions = {}): AsyncGenerator<string, void, unknown> {
    if (!this.isReady) {
      throw new Error('Engine not initialized');
    }

    const body: Record<string, unknown> = {
      model: MODEL_INFO.serverModelId,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
      temperature: 0.7,
      // Safety ceiling, NOT a target — replies end naturally on the stop token, so
      // this only bounds the occasional long explanation. We're tutoring kids, so we
      // keep room for a complete worked-through answer; it streams, so length doesn't
      // re-introduce the "no response" feel (that was first-token latency, fixed by the
      // history window + server prompt-cache, not by this cap).
      max_tokens: 640,
    };

    // Apply the per-language LoRA scales (llama.cpp server `lora` field).
    // Adapters must be pre-loaded on the server via --lora flags (see config/model.ts).
    if (options.lora && options.lora.length > 0) {
      body.lora = options.lora;
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Chat request failed: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              yield content;
            }
          } catch (e) {
            // Ignore parse errors for incomplete JSON
          }
        }
      }
    }
  }

  async generateImage(prompt: string): Promise<string | null> {
    if (!this.isReady) {
      throw new Error('Engine not initialized');
    }

    const response = await fetch(`${this.baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        n: 1,
        size: '512x512',
      }),
    });

    if (!response.ok) {
      console.error(`Image generation failed: ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    return data.data?.[0]?.url || null;
  }

  async shutdown(): Promise<void> {
    this.isReady = false;
  }
}
