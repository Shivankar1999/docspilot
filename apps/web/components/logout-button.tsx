'use client';

import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/api';

export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh(); // drop cached server-rendered dashboard pages
  }

  return (
    <button onClick={logout} className="text-sm font-medium text-slate-500 hover:text-slate-900">
      Log out
    </button>
  );
}
