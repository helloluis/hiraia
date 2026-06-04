import { create } from 'zustand';
import { useEngineStore } from './engineStore';
import { generateSystemPrompt, formatGroundingBlock } from '@hiraia/shared';
import type { Message, RagResult } from '@hiraia/shared';

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
      // Retrieve curated curriculum facts for this question and ground the model
      // on them (the on-device 1B hallucinates science without grounding).
      let grounding: RagResult[] = [];
      try {
        grounding = await engine.ragSearch(content, 3);
      } catch (ragError) {
        console.warn('RAG search failed; answering ungrounded:', ragError);
      }

      // Build the system prompt, then append the verified facts (if any matched).
      let systemPrompt = generateSystemPrompt('english', 7);
      const groundingBlock = formatGroundingBlock(grounding);
      if (groundingBlock) {
        systemPrompt += `\n\n${groundingBlock}`;
      }

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
