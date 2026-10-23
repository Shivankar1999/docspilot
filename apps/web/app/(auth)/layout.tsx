import Link from 'next/link';

// Centered card shared by /login and /signup. "(auth)" is a route group: it
// shares this layout without adding "/auth" to the URL.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 block text-center text-2xl font-bold tracking-tight">
          DocsPilot
        </Link>
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">{children}</div>
      </div>
    </main>
  );
}
