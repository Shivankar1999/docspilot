'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { postEventStream } from '@/lib/sse';
import type { Citation } from '@/lib/types';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  cached?: boolean;
  error?: boolean;
}

/**
 * A streaming chat window. Used by the dashboard playground (session cookie) and
 * by the embeddable widget, which authenticates with its public-key headers.
 */
export function ChatPanel({
  headers,
  placeholder = 'Ask a question about your documents…',
  emptyText = 'Answers come only from your uploaded documents, with sources.',
}: {
  headers?: Record<string, string>;
  placeholder?: string;
  emptyText?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep the newest text in view while tokens stream in. Block body on purpose:
  // scrollIntoView() returns a Promise in recent browsers, and an effect must not
  // return anything except a cleanup function (React would try to call it).
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  // Updates the last (assistant) message in place as events arrive.
  const updateLast = (change: (m: ChatMessage) => ChatMessage) =>
    setMessages((all) => [...all.slice(0, -1), change(all[all.length - 1])]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const question = input.trim();
    if (!question || busy) return;

    setInput('');
    setBusy(true);
    setMessages((all) => [...all, { role: 'user', content: question }, { role: 'assistant', content: '' }]);

    try {
      await postEventStream(
        '/api/chat',
        { message: question, conversationId },
        (name, data) => {
          if (name === 'meta') setConversationId(data.conversationId);
          if (name === 'token') updateLast((m) => ({ ...m, content: m.content + data.text }));
          if (name === 'done') updateLast((m) => ({ ...m, citations: data.citations, cached: data.cached }));
          if (name === 'error') updateLast((m) => ({ ...m, content: data.message, error: true }));
        },
        { headers },
      );
    } catch (err) {
      updateLast((m) => ({ ...m, content: (err as Error).message, error: true }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="pt-8 text-center text-sm text-slate-500">{emptyText}</p>
        )}
        {messages.map((message, i) => (
          <MessageBubble key={i} message={message} streaming={busy && i === messages.length - 1} />
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={send} className="flex gap-2 border-t border-slate-200 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          maxLength={2000}
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Send
        </button>
      </form>
      {conversationId && !busy && (
        <button
          onClick={() => {
            setMessages([]);
            setConversationId(undefined);
          }}
          className="pb-2 text-xs text-slate-500 hover:text-slate-800"
        >
          Start a new conversation
        </button>
      )}
    </div>
  );
}

function MessageBubble({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  if (message.role === 'user') {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2 text-sm text-white">
        {message.content}
      </div>
    );
  }
  return (
    <div className="max-w-[85%]">
      <div
        className={`whitespace-pre-wrap rounded-2xl rounded-bl-sm px-4 py-2 text-sm ${
          message.error ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-900'
        }`}
      >
        {message.content ? renderWithMarkers(message.content) : streaming ? <TypingDots /> : null}
      </div>
      {message.citations && message.citations.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {message.citations.map((c) => (
            <li
              key={c.number}
              title={`Similarity ${(c.similarity * 100).toFixed(0)}%`}
              className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600"
            >
              <span className="font-semibold text-indigo-600">[{c.number}]</span> {c.filename} · part{' '}
              {c.chunkIndex + 1}
            </li>
          ))}
        </ul>
      )}
      {message.cached && <p className="mt-1 text-xs text-slate-400">Instant answer (cached)</p>}
    </div>
  );
}

// Shows [1]-style citation markers as small badges inside the answer text.
function renderWithMarkers(text: string) {
  return text.split(/(\[\d+\])/g).map((part, i) =>
    /^\[\d+\]$/.test(part) ? (
      <sup key={i} className="mx-0.5 font-semibold text-indigo-600">
        {part}
      </sup>
    ) : (
      part
    ),
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1" aria-label="Thinking">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
