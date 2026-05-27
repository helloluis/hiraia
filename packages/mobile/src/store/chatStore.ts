import { create } from 'zustand';

import type { Message } from '@hiraia/shared';

interface ChatState {
  messages: Message[];
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],

  sendMessage: async (content: string) => {
    const userMessage: Message = {
      role: 'user',
      content,
      timestamp: new Date(),
    };

    set((state) => ({
      messages: [...state.messages, userMessage],
    }));

    // TODO: Implement actual QVAC inference
    // For now, simulate a response
    setTimeout(() => {
      const assistantMessage: Message = {
        role: 'assistant',
        content: `I received your message: "${content}". QVAC integration coming soon!`,
        timestamp: new Date(),
      };

      set((state) => ({
        messages: [...state.messages, assistantMessage],
      }));
    }, 1000);
  },

  clearMessages: () => set({ messages: [] }),
}));
