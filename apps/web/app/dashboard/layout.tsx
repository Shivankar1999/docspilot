import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LogoutButton } from '@/components/logout-button';
import { NavLink } from '@/components/nav-link';
import { getMe } from '@/lib/server-api';

// Every /dashboard page renders inside this layout, so this one check protects them all.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/login');

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex flex-col gap-6 border-b border-slate-200 bg-white p-4 md:w-60 md:border-b-0 md:border-r">
        <div>
          <Link href="/dashboard" className="text-lg font-bold tracking-tight">
            DocsPilot
          </Link>
          <p className="truncate text-sm text-slate-500">{me.tenant.name}</p>
        </div>
        <nav className="flex flex-wrap gap-1 md:flex-col">
          <NavLink href="/dashboard/documents">Documents</NavLink>
          <NavLink href="/dashboard/chat">Playground</NavLink>
          <NavLink href="/dashboard/usage">Usage</NavLink>
          <NavLink href="/dashboard/settings">Settings</NavLink>
          {me.user.isAdmin && <NavLink href="/dashboard/admin">Admin</NavLink>}
        </nav>
        <div className="flex items-center justify-between gap-2 md:mt-auto md:flex-col md:items-start">
          <span className="min-w-0 max-w-full truncate text-sm text-slate-600" title={me.user.email}>
            {me.user.email}
          </span>
          <LogoutButton />
        </div>
      </aside>
      <main className="flex-1 px-4 py-8 md:px-10">{children}</main>
    </div>
  );
}
