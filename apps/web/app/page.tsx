import Link from 'next/link';
import { apiUrl } from '@/lib/server-api';

// Render on every request so the status reflects the API now, not at build time.
export const dynamic = 'force-dynamic';

async function getApiStatus(): Promise<'up' | 'down'> {
  try {
    const res = await fetch(apiUrl('/health'), {
      cache: 'no-store',
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

export default async function HomePage() {
  const api = await getApiStatus();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-24">
      <h1 className="text-4xl font-bold tracking-tight">DocsPilot</h1>
      <p className="text-lg text-slate-600">
        Upload your docs and get an embeddable chat assistant that answers only from them, with
        citations.
      </p>
      <div className="flex gap-3">
        <Link
          href="/signup"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
        >
          Get started
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Log in
        </Link>
      </div>
      <p className="flex items-center gap-2 text-sm text-slate-700">
        <span
          className={`h-2.5 w-2.5 rounded-full ${api === 'up' ? 'bg-emerald-500' : 'bg-rose-500'}`}
        />
        API {api === 'up' ? 'healthy' : 'unreachable'}
      </p>
    </main>
  );
}
