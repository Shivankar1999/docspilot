import { StatTile } from '@/components/stat-tile';
import { formatCost, formatDateTime, formatNumber } from '@/lib/format';
import { apiGet } from '@/lib/server-api';
import type { AdminOverview, DocumentStatus } from '@/lib/types';

const STATUSES: DocumentStatus[] = ['pending', 'processing', 'ready', 'failed'];
const QUEUE_STATES = ['waiting', 'active', 'delayed', 'completed', 'failed'] as const;

export default async function AdminPage() {
  const data = await apiGet<AdminOverview>('/api/admin/overview');
  if (!data) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="mt-2 text-slate-600">This page is only available to platform admins (ADMIN_EMAILS).</p>
      </div>
    );
  }

  const { last30Days: usage } = data;
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p className="mt-1 text-slate-600">Platform health across all tenants. Usage covers the last 30 days.</p>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="Tenants" value={formatNumber(data.tenants)} />
        <StatTile label="Messages" value={formatNumber(usage.messages)} />
        <StatTile label="Estimated AI cost" value={formatCost(usage.costUsd)} />
        <StatTile
          label="Cache hit rate"
          value={usage.cacheHitRate === null ? '—' : `${Math.round(usage.cacheHitRate * 100)}%`}
        />
        <StatTile
          label="p95 answer time"
          value={usage.p95LatencyMs === null ? '—' : `${(usage.p95LatencyMs / 1000).toFixed(1)} s`}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Documents by status">
          <CountRow items={STATUSES.map((s) => ({ label: s, value: data.documents[s] ?? 0, alert: s === 'failed' }))} />
        </Card>
        <Card title="Ingestion queue">
          <CountRow items={QUEUE_STATES.map((s) => ({ label: s, value: data.queue[s] ?? 0, alert: s === 'failed' }))} />
        </Card>
      </div>

      <Card title="Recent failed jobs" className="mt-6">
        {data.failedJobs.length === 0 ? (
          <p className="text-sm text-slate-500">No failed jobs in the last 7 days.</p>
        ) : (
          <Table
            headers={['When', 'Tenant', 'File', 'Attempts', 'Reason']}
            rows={data.failedJobs.map((job) => [
              job.failedAt ? formatDateTime(job.failedAt) : '—',
              job.tenantName ?? '(deleted)',
              job.filename ?? '(deleted)',
              job.attempts === null ? '—' : String(job.attempts),
              job.reason,
            ])}
          />
        )}
      </Card>

      <Card title="Top tenants by cost" className="mt-6">
        {data.topTenants.length === 0 ? (
          <p className="text-sm text-slate-500">No usage yet.</p>
        ) : (
          <Table
            headers={['Tenant', 'Messages', 'Est. cost']}
            rows={data.topTenants.map((t) => [t.name, formatNumber(t.messages), formatCost(t.costUsd)])}
          />
        )}
      </Card>
    </div>
  );
}

function Card({ title, className = '', children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

// Counts in a row. A non-zero "failed" count gets an icon + label, not just a color.
function CountRow({ items }: { items: { label: string; value: number; alert?: boolean }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="rounded-md bg-slate-50 p-3">
          <dt className="flex items-center gap-1 text-xs capitalize text-slate-500">
            {item.alert && item.value > 0 && (
              <span className="h-2 w-2 rounded-full" style={{ background: 'var(--status-critical)' }} aria-hidden="true" />
            )}
            {item.label}
            {item.alert && item.value > 0 && <span className="sr-only">(needs attention)</span>}
          </dt>
          <dd className="text-lg font-semibold text-slate-900">{formatNumber(item.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-slate-700">
          {rows.map((cells, i) => (
            <tr key={i} className="align-top">
              {cells.map((cell, j) => (
                <td key={j} className="px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
