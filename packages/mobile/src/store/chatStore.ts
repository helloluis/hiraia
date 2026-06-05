import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useEngineStore } from './engineStore';
import { generateSystemPrompt, formatGroundingBlock } from '@hiraia/shared';
import type { Message, RagResult } from '@hiraia/shared';

import { pickFactoidText } from '../data/factoids';

interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  currentStreamingContent: string;
  hasHydrated: boolean;
  lastFactoidId?: string;
  sendMessage: (content: string) => Promise<void>;
  showColdStartFactoid: () => void;
  clearMessages: () => void;
  _setHydrated: () => void;
}

/** Persisted timestamps come back as ISO strings — revive them to Date. */
const reviveMessages = (msgs: Message[] = []): Message[] =>
  msgs.map((m) => ({ ...m, timestamp: m.timestamp ? new Date(m.timestamp) : undefined }));

const isFactoid = (m: Message) => m.metadata?.kind === 'factoid';

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      isStreaming: false,
      currentStreamingContent: '',
      hasHydrated: false,
      lastFactoidId: undefined,

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
          // on them (the on-device model hallucinates science without grounding).
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

          // Factoid cards aren't conversation turns — keep them out of the model's context.
          const conversationMessages: Message[] = [
            { role: 'system', content: systemPrompt },
            ...get().messages.filter((m) => !isFactoid(m)),
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

      // Drop a pre-written "Alam mo ba na…?" factoid into the thread so there's
      // something to read while the model warms up. Pre-written prose (not the
      // model — it isn't loaded yet). Not persisted; a fresh one shows each cold start.
      showColdStartFactoid: () => {
        const picked = pickFactoidText('tagalog', get().lastFactoidId);
        if (!picked) return;
        set((state) => ({
          messages: [
            ...state.messages,
            {
              role: 'assistant',
              content: picked.text,
              timestamp: new Date(),
              metadata: { kind: 'factoid' },
            },
          ],
          lastFactoidId: picked.id,
        }));
      },

      clearMessages: () => set({ messages: [], isStreaming: false, currentStreamingContent: '' }),

      _setHydrated: () => set({ hasHydrated: true }),
    }),
    {
      name: 'hiraia-chat',
      storage: createJSONStorage(() => AsyncStorage),
      // Persist only real conversation turns — never the transient factoid cards
      // or the in-flight streaming state.
      partialize: (state) => ({
        messages: state.messages.filter((m) => !isFactoid(m)),
        lastFactoidId: state.lastFactoidId,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ChatState>;
        return { ...current, ...p, messages: reviveMessages(p.messages) };
      },
      onRehydrateStorage: () => (state) => {
        state?._setHydrated();
      },
    }
  )
);
