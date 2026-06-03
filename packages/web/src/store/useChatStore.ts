import { create } from 'zustand';
import { RemoteEngine } from '@/engine/RemoteEngine';
import { LANGUAGES, loraScalesFor, type LanguageKey } from '@/config/model';

export interface User { id: number; email: string }
export interface Chat { id: number; title: string | null; is_primary: number; created_at: string }
export interface UiMessage {
  id?: number; // db id (present once persisted)
  role: 'user' | 'assistant' | 'system';
  content: string;
  message_feedback?: number | null; // 1 useful | -1 not useful | null
}

const DEFAULT_SERVER =
  (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_QVAC_URL) || 'http://localhost:8080';

interface ChatState {
  // auth
  user: User | null;
  authChecked: boolean;
  // model server connection
  engine: RemoteEngine | null;
  serverUrl: string;
  connected: boolean;
  // threads + messages
  chats: Chat[];
  currentChatId: number | null;
  messages: UiMessage[];
  // ui
  isLoading: boolean;
  error: string | null;

  checkAuth: () => Promise<void>;
  authenticate: (mode: 'login' | 'signup', email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  setServerUrl: (url: string) => void;
  connect: (url?: string) => Promise<boolean>;
  loadChats: () => Promise<void>;
  selectChat: (id: number) => Promise<void>;
  createChat: (title?: string) => Promise<void>;
  renameChat: (id: number, title: string) => Promise<void>;
  sendMessage: (content: string, language: LanguageKey) => Promise<void>;
  setFeedback: (messageId: number, feedback: number) => Promise<void>;
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const useChatStore = create<ChatState>((set, get) => ({
  user: null,
  authChecked: false,
  engine: null,
  serverUrl:
    (typeof window !== 'undefined' && localStorage.getItem('hiraia_server_url')) || DEFAULT_SERVER,
  connected: false,
  chats: [],
  currentChatId: null,
  messages: [],
  isLoading: false,
  error: null,

  checkAuth: async () => {
    try {
      const { user } = await api('/api/auth/me');
      set({ user, authChecked: true });
      if (user) {
        await get().loadChats();
        // best-effort connect to the model server in the background
        get().connect().catch(() => {});
      }
    } catch {
      set({ authChecked: true });
    }
  },

  authenticate: async (mode, email, password) => {
    try {
      const { user } = await api(`/api/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      set({ user, error: null });
      await get().loadChats();
      get().connect().catch(() => {});
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Authentication failed' });
      return false;
    }
  },

  logout: async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    set({ user: null, chats: [], currentChatId: null, messages: [] });
  },

  setServerUrl: (url) => {
    if (typeof window !== 'undefined') localStorage.setItem('hiraia_server_url', url);
    set({ serverUrl: url, connected: false });
  },

  connect: async (url) => {
    const serverUrl = url ?? get().serverUrl;
    try {
      const engine = new RemoteEngine(serverUrl);
      await engine.initialize();
      set({ engine, connected: true, serverUrl, error: null });
      if (typeof window !== 'undefined') localStorage.setItem('hiraia_server_url', serverUrl);
      return true;
    } catch (e) {
      set({ connected: false, error: e instanceof Error ? e.message : 'Could not reach model server' });
      return false;
    }
  },

  loadChats: async () => {
    const { chats } = await api('/api/chats');
    set({ chats });
    // land on the current chat if still present, else the primary/first thread
    const cur = get().currentChatId;
    const stillThere = chats.find((c: Chat) => c.id === cur);
    const target = stillThere ?? chats[0];
    if (target) await get().selectChat(target.id);
  },

  selectChat: async (id) => {
    set({ currentChatId: id, error: null });
    const { messages } = await api(`/api/chats/${id}/messages`);
    set({ messages });
  },

  createChat: async (title) => {
    const { chat } = await api('/api/chats', {
      method: 'POST',
      body: JSON.stringify({ title: title ?? null }),
    });
    set({ chats: [...get().chats, chat] });
    await get().selectChat(chat.id);
  },

  renameChat: async (id, title) => {
    const { chat } = await api(`/api/chats/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
    set({ chats: get().chats.map((c) => (c.id === id ? chat : c)) });
  },

  sendMessage: async (content, language) => {
    const { engine, currentChatId, messages } = get();
    if (!currentChatId) {
      set({ error: 'No chat selected' });
      return;
    }
    if (!engine || !get().connected) {
      const ok = await get().connect();
      if (!ok) return; // error already set
    }
    const activeEngine = get().engine!;
    set({ isLoading: true, error: null });

    try {
      // persist + show the user message
      const { message: userMsg } = await api(`/api/chats/${currentChatId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ role: 'user', content }),
      });
      const history = [...messages, userMsg as UiMessage];
      set({ messages: history });

      // streaming placeholder
      const placeholder: UiMessage = { role: 'assistant', content: '' };
      set({ messages: [...history, placeholder] });

      const langConfig = LANGUAGES[language] ?? LANGUAGES.english;
      const conversation = [
        { role: 'system' as const, content: langConfig.system, timestamp: new Date() },
        ...history.map((m) => ({ role: m.role, content: m.content, timestamp: new Date() })),
      ];

      let assistantContent = '';
      for await (const token of activeEngine.chat(conversation, { lora: loraScalesFor(language) })) {
        assistantContent += token;
        set({ messages: [...history, { role: 'assistant', content: assistantContent }] });
      }

      // persist the assistant message and swap in the version that has a db id
      const { message: savedAssistant } = await api(`/api/chats/${currentChatId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ role: 'assistant', content: assistantContent }),
      });
      set({ messages: [...history, savedAssistant as UiMessage], isLoading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Chat failed', isLoading: false });
    }
  },

  setFeedback: async (messageId, feedback) => {
    // toggle off if the same thumb is clicked again
    const current = get().messages.find((m) => m.id === messageId)?.message_feedback ?? null;
    const next = current === feedback ? null : feedback;
    set({
      messages: get().messages.map((m) =>
        m.id === messageId ? { ...m, message_feedback: next } : m
      ),
    });
    try {
      await api(`/api/messages/${messageId}/feedback`, {
        method: 'POST',
        body: JSON.stringify({ feedback: next }),
      });
    } catch {
      // revert on failure
      set({
        messages: get().messages.map((m) =>
          m.id === messageId ? { ...m, message_feedback: current } : m
        ),
      });
    }
  },
}));
