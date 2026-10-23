'use client';

import { useEffect, useState } from 'react';
import { ChatPanel } from '@/components/chat-panel';

/**
 * The website embedding this iframe. Prefer what the browser itself reports
 * (ancestorOrigins in Chromium/Safari, then the referrer), which the embedding
 * page can't fake; fall back to the hint widget.js passed in the URL.
 */
function embeddingOrigin(hint: string | null): string {
  const ancestors = window.location.ancestorOrigins;
  if (ancestors && ancestors.length > 0) return ancestors[0];
  if (document.referrer) return new URL(document.referrer).origin;
  return hint ?? '';
}

export function WidgetChat({
  publicKey,
  companyName,
  originHint,
}: {
  publicKey: string;
  companyName: string;
  originHint: string | null;
}) {
  // window is only available in the browser, so the origin is read after mount.
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    setOrigin(embeddingOrigin(originHint));
  }, [originHint]);

  return (
    <main className="flex h-dvh flex-col bg-white">
      <header className="bg-indigo-600 px-4 py-3 text-white">
        <p className="font-semibold">{companyName} support</p>
        <p className="text-xs text-indigo-100">Answers from our help docs, with sources</p>
      </header>
      <div className="min-h-0 flex-1">
        {origin !== null && (
          <ChatPanel
            headers={{ 'X-Widget-Key': publicKey, 'X-Widget-Origin': origin }}
            placeholder="Ask a question…"
            emptyText={`Hi! Ask anything about ${companyName}.`}
          />
        )}
      </div>
      <p className="border-t border-slate-100 py-1.5 text-center text-[11px] text-slate-400">Powered by DocsPilot</p>
    </main>
  );
}
