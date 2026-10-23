'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CopyButton } from '@/components/copy-button';
import { Button, ErrorMessage } from '@/components/form';
import { apiRequest } from '@/lib/api';
import type { Tenant } from '@/lib/types';

export function SettingsForm({ tenant }: { tenant: Tenant }) {
  return (
    <>
      <InstallSection publicKey={tenant.publicKey} />
      <AllowedDomainsSection initial={tenant.allowedDomains} />
      <SecretKeySection initiallyCreated={tenant.hasSecretKey} />
      <LimitsSection tenant={tenant} />
    </>
  );
}

function InstallSection({ publicKey }: { publicKey: string }) {
  // The snippet points at wherever this dashboard is served from (read after mount).
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const snippet = `<script src="${origin}/widget.js" data-key="${publicKey}" defer></script>`;

  return (
    <Section
      title="Install the chat widget"
      description="Paste this before </body> on your website. The public key is safe to expose: it only works on your allowed domains."
    >
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-md bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100">
          {snippet}
        </pre>
        <CopyButton value={snippet} />
      </div>
      <p className="mt-3 text-sm text-slate-600">
        Try it locally: add <code className="rounded bg-slate-100 px-1">localhost:3000</code> to the allowed domains
        below, then open{' '}
        <a href={`/widget-demo.html?key=${publicKey}`} target="_blank" className="font-medium text-indigo-600 hover:underline">
          the demo page
        </a>
        .
      </p>
    </Section>
  );
}

function AllowedDomainsSection({ initial }: { initial: string[] }) {
  const [text, setText] = useState(initial.join('\n'));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const allowedDomains = text.split('\n').map((d) => d.trim()).filter(Boolean);
      const { tenant } = await apiRequest<{ tenant: Tenant }>('/api/tenant', {
        method: 'PATCH',
        body: { allowedDomains },
      });
      setText(tenant.allowedDomains.join('\n')); // show the normalized list
      setStatus({ ok: true, message: 'Saved' });
    } catch (err) {
      setStatus({ ok: false, message: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="Allowed domains"
      description="One per line, e.g. example.com, *.example.com or localhost:3000. The widget refuses to load anywhere else."
    >
      <form onSubmit={save} className="flex flex-col gap-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="example.com"
          className="rounded-md border border-slate-300 px-3 py-2 font-mono text-sm shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
        />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save domains'}
          </Button>
          {status?.ok && <span className="text-sm text-emerald-600">{status.message}</span>}
        </div>
        {status && !status.ok && <ErrorMessage>{status.message}</ErrorMessage>}
      </form>
    </Section>
  );
}

function SecretKeySection({ initiallyCreated }: { initiallyCreated: boolean }) {
  const [created, setCreated] = useState(initiallyCreated);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (created && !confirm('Generate a new key? The current key stops working immediately.')) {
      return;
    }
    setError(null);
    try {
      const { secretKey } = await apiRequest<{ secretKey: string }>('/api/tenant/secret-key', {
        method: 'POST',
      });
      setNewKey(secretKey);
      setCreated(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Section
      title="Secret API key"
      description="For your servers: send it as Authorization: Bearer sk_… Never put it in a browser or a public repo."
    >
      {newKey ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            Copy this key now. For your security it won&apos;t be shown again.
          </p>
          <KeyBox value={newKey} />
        </div>
      ) : (
        <p className="text-sm text-slate-600">
          Status:{' '}
          <span className="font-medium text-slate-900">{created ? 'Active' : 'Not created yet'}</span>
        </p>
      )}
      <div className="mt-3">
        <Button variant="secondary" onClick={generate}>
          {created ? 'Regenerate key' : 'Generate key'}
        </Button>
      </div>
      {error && <div className="mt-3"><ErrorMessage>{error}</ErrorMessage></div>}
    </Section>
  );
}

function LimitsSection({ tenant }: { tenant: Tenant }) {
  const limits = [
    { label: 'Messages / month', value: tenant.monthlyMessageLimit.toLocaleString() },
    { label: 'Documents', value: tenant.maxDocuments.toLocaleString() },
    { label: 'Storage', value: `${Math.round(tenant.maxStorageBytes / 1024 / 1024)} MB` },
  ];
  return (
    <Section title="Plan limits" description="Usage tracking against these limits arrives in Phase 6.">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {limits.map((l) => (
          <div key={l.label} className="rounded-md bg-slate-50 p-3">
            <dt className="text-xs text-slate-500">{l.label}</dt>
            <dd className="text-lg font-semibold">{l.value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="font-semibold">{title}</h2>
      <p className="mb-4 mt-1 text-sm text-slate-600">{description}</p>
      {children}
    </section>
  );
}

function KeyBox({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md bg-slate-100 px-3 py-2 font-mono text-sm">
        {value}
      </code>
      <CopyButton value={value} />
    </div>
  );
}
