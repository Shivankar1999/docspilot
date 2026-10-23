import { ChatPanel } from '@/components/chat-panel';

export default function PlaygroundPage() {
  return (
    <div className="flex max-w-3xl flex-col">
      <h1 className="text-2xl font-semibold">Playground</h1>
      <p className="mt-1 text-slate-600">
        Test your assistant exactly as customers will see it: same retrieval, same prompt.
      </p>
      <div className="mt-6 h-[65vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <ChatPanel />
      </div>
    </div>
  );
}
