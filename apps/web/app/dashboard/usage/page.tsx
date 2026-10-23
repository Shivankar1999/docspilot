import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ColumnChart } from '@/components/charts/column-chart';
import { StatTile } from '@/components/stat-tile';
import { formatBytes, formatCost, formatNumber, formatShortDate } from '@/lib/format';
import { apiGet } from '@/lib/server-api';
import type { UsageSummary } from '@/lib/types';

const RANGES = [7, 30, 90];

export default async function UsagePage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const requested = Number((await searchParams).days);
  const days = RANGES.includes(requested) ? requested : 30;
  const usage = await apiGet<UsageSummary>(`/api/usage?days=${days}`);
  if (!usage) redirect('/login');

  const { month, daily } = usage;
  const totalMessages = daily.reduce((sum, d) => sum + d.messages, 0);
  const totalCacheHits = daily.reduce((sum, d) => sum + d.cacheHits, 0);

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">Usage</h1>
      <p className="mt-1 text-slate-600">
        This month&apos;s usage against your plan. Limits reset on {formatShortDate(month.resetsAt)}.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Messages this month"
          value={formatNumber(month.messages)}
          caption={`of ${formatNumber(month.messageLimit)} included`}
          meter={{ used: month.messages, max: month.messageLimit }}
        />
        <StatTile
          label="Documents"
          value={formatNumber(month.documents)}
          caption={`of ${formatNumber(month.documentLimit)} included`}
          meter={{ used: month.documents, max: month.documentLimit }}
        />
        <StatTile
          label="Storage"
          value={formatBytes(month.storageBytes)}
          caption={`of ${formatBytes(month.storageLimit)} included`}
          meter={{ used: month.storageBytes, max: month.storageLimit }}
        />
        <StatTile label="Estimated AI cost this month" value={formatCost(month.costUsd)} caption="Chat and embedding tokens" />
      </div>

      {/* One filter row, above everything it scopes. */}
      <nav className="mt-8 flex gap-1" aria-label="Date range">
        {RANGES.map((range) => (
          <Link
            key={range}
            href={`?days=${range}`}
            aria-current={range === days ? 'page' : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              range === days ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white'
            }`}
          >
            Last {range} days
          </Link>
        ))}
      </nav>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Messages per day"
          subtitle={`${formatNumber(totalMessages)} messages · ${
            totalMessages ? Math.round((totalCacheHits / totalMessages) * 100) : 0
          }% answered from cache`}
        >
          <ColumnChart
            title="Messages per day"
            unit="number"
            series={[
              { name: 'Generated', color: 'var(--series-1)' },
              { name: 'From cache', color: 'var(--series-2)' },
            ]}
            days={daily.map((d) => ({ date: d.date, values: [d.messages - d.cacheHits, d.cacheHits] }))}
          />
        </ChartCard>

        <ChartCard title="Tokens per day" subtitle="Chat input and output, plus embeddings for uploads and questions">
          <ColumnChart
            title="Tokens per day"
            unit="compact"
            series={[
              { name: 'Input', color: 'var(--series-1)' },
              { name: 'Output', color: 'var(--series-2)' },
              { name: 'Embedding', color: 'var(--series-3)' },
            ]}
            days={daily.map((d) => ({ date: d.date, values: [d.inputTokens, d.outputTokens, d.embeddingTokens] }))}
          />
        </ChartCard>

        <ChartCard title="Estimated cost per day" subtitle="List prices; mock providers are free">
          <ColumnChart
            title="Estimated cost per day"
            unit="cost"
            emptyMessage="No cost yet: the mock providers are free"
            series={[{ name: 'Estimated cost', color: 'var(--series-1)' }]}
            days={daily.map((d) => ({ date: d.date, values: [d.costUsd] }))}
          />
        </ChartCard>
      </div>

      {/* The table twin of the charts: every value readable without hovering. */}
      <details className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700">View data as a table</summary>
        <div className="overflow-x-auto border-t border-slate-200">
          <table className="w-full text-right text-sm tabular-nums">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {['Date', 'Messages', 'From cache', 'Input tokens', 'Output tokens', 'Embedding tokens', 'Est. cost'].map((h) => (
                  <th key={h} className="px-4 py-2 font-medium first:text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {[...daily].reverse().map((d) => (
                <tr key={d.date}>
                  <td className="px-4 py-2 text-left">{formatShortDate(d.date)}</td>
                  <td className="px-4 py-2">{formatNumber(d.messages)}</td>
                  <td className="px-4 py-2">{formatNumber(d.cacheHits)}</td>
                  <td className="px-4 py-2">{formatNumber(d.inputTokens)}</td>
                  <td className="px-4 py-2">{formatNumber(d.outputTokens)}</td>
                  <td className="px-4 py-2">{formatNumber(d.embeddingTokens)}</td>
                  <td className="px-4 py-2">{formatCost(d.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold">{title}</h2>
      <p className="mb-3 text-xs text-slate-500">{subtitle}</p>
      {children}
    </section>
  );
}
