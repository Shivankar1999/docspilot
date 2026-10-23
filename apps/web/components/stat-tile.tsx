import type { ReactNode } from 'react';

/** Label · value · optional caption, and optionally a meter showing usage against a limit. */
export function StatTile({
  label,
  value,
  caption,
  meter,
}: {
  label: string;
  value: string;
  caption?: ReactNode;
  meter?: { used: number; max: number };
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {meter && <Meter {...meter} />}
      {caption && <p className="mt-1 text-xs text-slate-500">{caption}</p>}
    </div>
  );
}

// The fill carries severity; near or at the limit it also gets an icon + label,
// so the state never depends on color alone.
function Meter({ used, max }: { used: number; max: number }) {
  const ratio = max > 0 ? used / max : 0;
  const state = ratio >= 1 ? 'full' : ratio >= 0.8 ? 'near' : 'ok';
  const fill = { ok: 'var(--series-1)', near: 'var(--status-warning)', full: 'var(--status-critical)' }[state];
  const track = { ok: '#cde2fb', near: 'rgba(250,178,25,0.2)', full: 'rgba(208,59,59,0.15)' }[state];

  return (
    <div className="mt-3">
      <div
        className="h-1.5 overflow-hidden rounded-full"
        style={{ background: track }}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={used}
      >
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, ratio * 100)}%`, background: fill }} />
      </div>
      {state !== 'ok' && (
        <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-slate-700">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M8 1.5 15 14H1z" fill={fill} />
            <path d="M8 6v4M8 11.5v.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          {state === 'full' ? 'Limit reached' : 'Nearly used up'}
        </p>
      )}
    </div>
  );
}
