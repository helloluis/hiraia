import { create } from 'zustand';
import type { Message } from '@hiraia/shared';
import { RemoteEngine } from '@/engine/RemoteEngine';

interface ChatState {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  engine: RemoteEngine | null;
  initialized: boolean;

  initialize: (serverUrl?: string) => Promise<void>;
  sendMessage: (content: string, language?: string) => Promise<void>;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  error: null,
  engine: null,
  initialized: false,

  initialize: async (serverUrl?: string) => {
    try {
      const engine = new RemoteEngine(serverUrl);
      await engine.initialize({
        language: 'english',
        gradeLevel: 7,
        enableVisuals: true,
        enableRag: false,
      });
      set({ engine, initialized: true, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to initialize' });
    }
  },

  sendMessage: async (content: string, language: string = 'english') => {
    const { engine, messages } = get();
    if (!engine) {
      set({ error: 'Engine not initialized' });
      return;
    }

    const userMessage: Message = {
      role: 'user',
      content,
      timestamp: new Date(),
    };

    set({ messages: [...messages, userMessage], isLoading: true, error: null });

    try {
      // Build conversation with system prompt
      const systemPrompt = `You are Hiraia, a friendly and knowledgeable science tutor for Filipino students. You help explain scientific concepts in a clear, encouraging way using age-appropriate language. Speak in ${language}.`;

      const conversation: Message[] = [
        { role: 'system', content: systemPrompt },
        ...messages,
        userMessage,
      ];

      let assistantContent = '';
      const assistantMessage: Message = {
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      };

      set({ messages: [...messages, userMessage, assistantMessage] });

      for await (const token of engine.chat(conversation)) {
        assistantContent += token;
        set(state => ({
          messages: [
            ...state.messages.slice(0, -1),
            { ...assistantMessage, content: assistantContent },
          ],
        }));
      }

      set({ isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Chat failed',
        isLoading: false,
      });
    }
  },

  clearMessages: () => set({ messages: [], error: null }),
}));
