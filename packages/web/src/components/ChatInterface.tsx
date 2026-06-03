'use client';

import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '@/store/useChatStore';
import ReactMarkdownRaw from 'react-markdown';
import { MODEL_INFO, MODEL_STATS_LINE, LANGUAGES, type LanguageKey } from '@/config/model';
import { AuthScreen } from './AuthScreen';

// react-markdown 10's component type isn't assignable to the React 19 JSX
// component type (types-only mismatch); cast to a simple component shape.
const ReactMarkdown = ReactMarkdownRaw as unknown as React.ComponentType<{ children: string }>;

export function ChatInterface() {
  const [input, setInput] = useState('');
  const [language, setLanguage] = useState<LanguageKey>('english');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [showServerEdit, setShowServerEdit] = useState(false);
  const [serverDraft, setServerDraft] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    user, authChecked, checkAuth, logout,
    chats, currentChatId, selectChat, createChat, renameChat,
    messages, isLoading, error,
    connected, serverUrl, connect, setServerUrl, setFeedback,
    sendMessage,
  } = useChatStore();

  useEffect(() => { checkAuth(); }, [checkAuth]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    const message = input.trim();
    setInput('');
    await sendMessage(message, language);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
  };

  const saveServer = async () => {
    setServerUrl(serverDraft || serverUrl);
    setShowServerEdit(false);
    await connect(serverDraft || serverUrl);
  };

  if (!authChecked) {
    return <div className="flex items-center justify-center min-h-screen text-gray-400">Loading…</div>;
  }
  if (!user) return <AuthScreen />;

  const activeLang = LANGUAGES[language];

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Model status / notification bar */}
      <div className="bg-slate-900 text-slate-100 px-6 py-2 text-xs sm:text-sm">
        <div className="mx-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden />
            <span className="truncate">
              Chatting with <span className="font-semibold text-white">{MODEL_INFO.displayName}</span>
              {' '}— {MODEL_INFO.tagline}
            </span>
          </div>
          <div className="flex items-center gap-3 text-slate-300">
            <span className="hidden md:inline">{MODEL_STATS_LINE}</span>
            <span className="rounded-full bg-slate-700/80 px-2.5 py-0.5 font-medium text-white whitespace-nowrap">
              active: {activeLang.adapterLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-primary-600">Hiraia</h1>
            <button
              onClick={() => { setServerDraft(serverUrl); setShowServerEdit((v) => !v); }}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
              title={connected ? `Connected to ${serverUrl}` : `Not connected to ${serverUrl}`}
            >
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-red-400'}`} />
              {connected ? 'model online' : 'model offline'}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as LanguageKey)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
            >
              {(Object.keys(LANGUAGES) as LanguageKey[]).map((key) => (
                <option key={key} value={key}>{LANGUAGES[key].label}</option>
              ))}
            </select>
            <span className="hidden sm:inline text-sm text-gray-500">{user.email}</span>
            <button onClick={logout} className="text-sm text-gray-600 hover:text-gray-800">Log out</button>
          </div>
        </div>
        {showServerEdit && (
          <div className="mt-2 flex items-center gap-2">
            <input
              value={serverDraft}
              onChange={(e) => setServerDraft(e.target.value)}
              placeholder="http://localhost:8080"
              className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
            />
            <button onClick={saveServer} className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700">
              Connect
            </button>
          </div>
        )}
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Thread sidebar */}
        <aside className="w-60 shrink-0 border-r border-gray-200 bg-white flex flex-col">
          <button
            onClick={() => createChat()}
            className="m-3 px-3 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700"
          >
            + New chat
          </button>
          <nav className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
            {chats.map((c) => {
              const label = c.title || (c.is_primary ? 'Main thread' : 'Untitled chat');
              const active = c.id === currentChatId;
              return (
                <div
                  key={c.id}
                  className={`group rounded-lg px-3 py-2 text-sm cursor-pointer flex items-center justify-between gap-1 ${
                    active ? 'bg-primary-50 text-primary-700' : 'hover:bg-gray-100 text-gray-700'
                  }`}
                  onClick={() => selectChat(c.id)}
                >
                  {editingId === c.id ? (
                    <input
                      autoFocus
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={() => { renameChat(c.id, editTitle); setEditingId(null); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { renameChat(c.id, editTitle); setEditingId(null); }
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="flex-1 px-1 py-0.5 border border-gray-300 rounded text-sm"
                    />
                  ) : (
                    <>
                      <span className="truncate flex items-center gap-1">
                        {c.is_primary ? '⭐ ' : ''}{label}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingId(c.id); setEditTitle(c.title || ''); }}
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-700 text-xs"
                        title="Rename"
                      >
                        ✎
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>

        {/* Messages + input */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="max-w-3xl mx-auto space-y-4">
              {messages.length === 0 && (
                <div className="text-center py-12">
                  <div className="text-6xl mb-4">🎓</div>
                  <h2 className="text-xl font-semibold text-gray-700 mb-2">Welcome to Hiraia!</h2>
                  <p className="text-gray-600">Ask me anything about science. I&apos;m here to help you learn!</p>
                </div>
              )}

              {messages.map((message, index) => (
                <div key={message.id ?? `tmp-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[80%]">
                    <div
                      className={`rounded-2xl px-4 py-3 ${
                        message.role === 'user'
                          ? 'bg-primary-600 text-white'
                          : 'bg-white border border-gray-200 text-gray-800'
                      }`}
                    >
                      {message.role === 'assistant' ? (
                        <div className="prose prose-sm max-w-none">
                          <ReactMarkdown>{message.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      )}
                    </div>
                    {/* feedback thumbs on persisted assistant messages */}
                    {message.role === 'assistant' && message.id && (
                      <div className="flex gap-2 mt-1 pl-1">
                        <button
                          onClick={() => setFeedback(message.id!, 1)}
                          className={`text-sm ${message.message_feedback === 1 ? 'opacity-100' : 'opacity-40 hover:opacity-80'}`}
                          title="Helpful"
                        >👍</button>
                        <button
                          onClick={() => setFeedback(message.id!, -1)}
                          className={`text-sm ${message.message_feedback === -1 ? 'opacity-100' : 'opacity-40 hover:opacity-80'}`}
                          title="Not helpful"
                        >👎</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input */}
          <div className="bg-white border-t border-gray-200 px-6 py-4">
            <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask me about science..."
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                  rows={1}
                  disabled={isLoading}
                />
                <button
                  type="submit"
                  disabled={isLoading || !input.trim()}
                  className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  Send
                </button>
              </div>
              {error && (
                <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
