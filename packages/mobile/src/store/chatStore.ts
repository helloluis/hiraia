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

    // Always show the user's message immediately — never drop it silently.
    const userMessage: Message = {
      role: 'user',
      content,
      timestamp: new Date(),
    };
    set((state) => ({ messages: [...state.messages, userMessage] }));

    // The model takes ~20-30s to load on first launch. If it isn't ready yet,
    // tell the user to wait rather than swallowing their message.
    if (!engine || !engine.isReady()) {
      set((state) => ({
        messages: [
          ...state.messages,
          {
            role: 'assistant',
            content: 'Sandali lang—inihahanda ko pa ang AI. Pakisubukang muli sa ilang segundo. 🐻',
            timestamp: new Date(),
          },
        ],
      }));
      return;
    }

    set({ isStreaming: true, currentStreamingContent: '' });

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
      // Tagalog by default (matches the loaded fine-tune adapter + grounding language).
      let systemPrompt = generateSystemPrompt('tagalog', 7);
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
      set((state) => ({
        messages: [
          ...state.messages,
          {
            role: 'assistant',
            content: 'Paumanhin, may naganap na error. Pakisubukang muli. 🐻',
            timestamp: new Date(),
          },
        ],
        isStreaming: false,
        currentStreamingContent: '',
      }));
    }
  },

  clearMessages: () => set({ messages: [], isStreaming: false, currentStreamingContent: '' }),
}));
