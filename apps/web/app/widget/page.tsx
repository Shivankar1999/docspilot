import { apiUrl } from '@/lib/server-api';
import { WidgetChat } from './widget-chat';

// The page inside the widget's iframe. Which sites may frame it is enforced by the
// CSP header that proxy.ts adds; which sites may *chat* is checked again by the API.
export default async function WidgetPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string; origin?: string }>;
}) {
  const { key = '', origin } = await searchParams;
  const res = await fetch(apiUrl(`/api/widget/config?key=${encodeURIComponent(key)}`), { cache: 'no-store' });
  const widget: { name: string } | null = res.ok ? await res.json() : null;

  if (!widget) {
    return (
      <main className="flex h-dvh items-center justify-center bg-white p-6 text-center text-sm text-slate-500">
        This chat widget isn&apos;t set up correctly. Check the data-key on the script tag.
      </main>
    );
  }

  return <WidgetChat publicKey={key} companyName={widget.name} originHint={origin ?? null} />;
}
