import { redirect } from 'next/navigation';
import { getMe } from '@/lib/server-api';
import { SettingsForm } from './settings-form';

export default async function SettingsPage() {
  const me = await getMe(); // deduped with the layout's call
  if (!me) redirect('/login');

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-1 text-slate-600">
        Your API keys, and the websites allowed to embed your chat widget.
      </p>
      <SettingsForm tenant={me.tenant} />
    </div>
  );
}
