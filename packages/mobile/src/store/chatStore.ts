import { create } from 'zustand';
import { useEngineStore } from './engineStore';
import { generateSystemPrompt } from '@hiraia/shared';
import type { Message } from '@hiraia/shared';

interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  currentStreamingContent: string;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  currentStreamingContent: '',

  sendMessage: async (content: string) => {
    const { engine } = useEngineStore.getState();

    if (!engine || !engine.isReady()) {
      console.error('Engine not ready');
      return;
    }

    const userMessage: Message = {
      role: 'user',
      content,
      timestamp: new Date(),
    };

    set((state) => ({
      messages: [...state.messages, userMessage],
      isStreaming: true,
      currentStreamingContent: '',
    }));

    try {
      // Add system prompt as first message
      const systemPrompt = generateSystemPrompt({
        language: 'english',
        gradeLevel: 7,
      });

      const conversationMessages: Message[] = [
        { role: 'system', content: systemPrompt },
        ...get().messages,
      ];

      // Stream tokens from the engine
      let fullResponse = '';
      for await (const token of engine.chat(conversationMessages)) {
        fullResponse += token;
        set({ currentStreamingContent: fullResponse });
      }

      // Add the complete assistant message
      const assistantMessage: Message = {
        role: 'assistant',
        content: fullResponse,
        timestamp: new Date(),
      };

      set((state) => ({
        messages: [...state.messages, assistantMessage],
        isStreaming: false,
        currentStreamingContent: '',
      }));
    } catch (error) {
      console.error('Error during chat:', error);
      set({
        isStreaming: false,
        currentStreamingContent: '',
      });
    }
  },

  clearMessages: () => set({ messages: [], isStreaming: false, currentStreamingContent: '' }),
}));
