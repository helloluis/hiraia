import type { TutorEngine, Message, TutorConfig } from '@hiraia/shared';

/**
 * RemoteEngine - Connects to QVAC's OpenAI-compatible HTTP API
 * Used for web app to access remote QVAC server
 */
export class RemoteEngine implements TutorEngine {
  private baseUrl: string;
  private isReady: boolean = false;

  constructor(baseUrl: string = 'http://localhost:8080') {
    this.baseUrl = baseUrl;
  }

  async initialize(config: TutorConfig): Promise<void> {
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

  async *chat(messages: Message[]): AsyncGenerator<string, void, unknown> {
    if (!this.isReady) {
      throw new Error('Engine not initialized');
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen3-1.7b',
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        stream: true,
        temperature: 0.7,
        max_tokens: 2048,
      }),
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
