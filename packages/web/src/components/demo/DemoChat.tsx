'use client';

import { useEffect, useRef, useState } from 'react';
import { useDemoStore } from '@/store/useDemoStore';
import { type LanguageKey } from '@/config/model';
import { AssistantMessage } from '@/components/AssistantMessage';

/**
 * The demo chat surface inside the lightbox — a trimmed version of the
 * authenticated ChatInterface (no sidebar / threads / auth). It reads
 * `useDemoStore`, which streams the canned replies and logs every message to
 * the anonymous demo transcript (restored on reopen in the same browser).
 */

const PLACEHOLDER: Record<LanguageKey, string> = {
  tagalog: 'Magtanong tungkol sa agham...',
  english: 'Ask me anything about science...',
  cebuano: 'Pangutana bahin sa siyensya...',
};

// Shown beside the bouncing dots while the model retrieves + prefills + reasons (its
// <think> output is stripped, so the bubble stays "empty" for a few seconds). Without a
// label the wait reads as unresponsive; this makes it clearly alive, like the phone.
const THINKING: Record<LanguageKey, string> = {
  tagalog: 'Iniisip...',
  english: 'Thinking...',
  cebuano: 'Gihunahuna...',
};

export function DemoChat() {
  const { language, messages, isResponding, sendMessage } = useDemoStore();
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const activeLang = language ?? 'tagalog';

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isResponding) return;
    setInput('');
    sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(e);
    }
  };

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* Messages */}
      <div className="notebook-paper flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.map((message) => {
            const isFactoid = message.kind === 'factoid';
            const isEmptyAssistant = message.role === 'assistant' && message.content === '';
            return (
              <div
                key={message.id}
                className={`flex items-end gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.role === 'assistant' && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src="/hiraia-profile.png"
                    alt="Hiraia"
                    className="h-8 w-8 shrink-0 rounded-full ring-1 ring-gray-200"
                  />
                )}
                <div className="max-w-[80%]">
                  <div
                    className={`rounded-2xl px-4 py-3 ${
                      message.role === 'user'
                        ? 'bg-primary-600 text-white'
                        : isFactoid
                          ? 'border border-[#f3a228]/45 bg-[#fff3d6] text-[#5c3d00]'
                          : 'border border-gray-200 bg-white text-gray-800'
                    }`}
                  >
                    {message.role === 'assistant' ? (
                      isEmptyAssistant ? (
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            <div
                              className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                              style={{ animationDelay: '0ms' }}
                            />
                            <div
                              className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                              style={{ animationDelay: '150ms' }}
                            />
                            <div
                              className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                              style={{ animationDelay: '300ms' }}
                            />
                          </div>
                          <span className="text-sm italic text-gray-400">{THINKING[activeLang]}</span>
                        </div>
                      ) : isFactoid ? (
                        <p className="whitespace-pre-wrap font-body text-base">{message.content}</p>
                      ) : (
                        <AssistantMessage
                          content={message.content}
                          streaming={!!message.streaming}
                        />
                      )
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
        <form onSubmit={submit} className="mx-auto max-w-3xl">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={PLACEHOLDER[activeLang]}
              rows={1}
              className="flex-1 resize-none rounded-lg border border-gray-300 px-4 py-3 focus:border-transparent focus:ring-2 focus:ring-primary-500"
            />
            <button
              type="submit"
              disabled={isResponding || !input.trim()}
              className="rounded-lg bg-primary-600 px-6 py-3 text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
