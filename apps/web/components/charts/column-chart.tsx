'use client';

import { useEffect, useRef, useState } from 'react';
import { formatCompact, formatCost, formatNumber, formatShortDate } from '@/lib/format';

// Props from a server component must be serializable (no functions), so callers
// name a unit and the formatter is picked here, on the client side.
const FORMATTERS = { number: formatNumber, compact: formatCompact, cost: formatCost };

export interface ChartSeries {
  name: string;
  color: string; // a CSS variable reference, e.g. "var(--series-1)"
}

export interface ChartDay {
  date: string; // YYYY-MM-DD
  values: number[]; // one per series, same order
}

// The chart is drawn at its container's real pixel width (measured below), so
// 11px text stays 11px on every screen instead of being scaled with the drawing.
const H = 200;
const PAD = { top: 20, right: 8, bottom: 28, left: 52 };
const PLOT_H = H - PAD.top - PAD.bottom;
const BASELINE = PAD.top + PLOT_H;
const MAX_BAR = 24; // bars never fill their slot: the leftover is air
const RADIUS = 4; // rounded data-end, square at the baseline
const GAP = 2; // surface gap between stacked segments

/**
 * Daily column chart, stacked when given several series. One y-axis; legend for
 * 2+ series; only the peak column is labeled; every column is a hover/focus
 * target (the whole day's slot, not just the painted bar) with a tooltip.
 */
export function ColumnChart({
  days,
  series,
  unit,
  title,
  emptyMessage = 'No data in this period',
}: {
  days: ChartDay[];
  series: ChartSeries[];
  unit: keyof typeof FORMATTERS;
  title: string;
  emptyMessage?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [W, setWidth] = useState(480); // first paint (server render), corrected on mount
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const PLOT_W = W - PAD.left - PAD.right;
  const format = FORMATTERS[unit];
  const totals = days.map((d) => d.values.reduce((a, b) => a + b, 0));
  const peakTotal = Math.max(0, ...totals);
  const max = niceCeiling(peakTotal);
  const scale = (value: number) => (value / max) * PLOT_H;
  const slot = PLOT_W / days.length;
  const barWidth = Math.min(MAX_BAR, slot * 0.6);
  const labelEvery = days.length <= 10 ? 1 : 7;
  const centerOf = (i: number) => PAD.left + slot * i + slot / 2;
  const peakIndex = totals.indexOf(peakTotal);

  return (
    <div className="relative" ref={containerRef}>
      {series.length > 1 && (
        <ul className="mb-2 flex flex-wrap gap-4 text-xs text-slate-600">
          {series.map((s) => (
            <li key={s.name} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
              {s.name}
            </li>
          ))}
        </ul>
      )}

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={title}>
        {[0, max / 2, max].map((tick) => {
          const y = BASELINE - scale(tick);
          return (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y}
                y2={y}
                stroke={tick === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'}
                strokeWidth={1}
              />
              <text x={PAD.left - 8} y={y + 4} textAnchor="end" fontSize={11} fill="var(--chart-muted)" className="tabular-nums">
                {format(tick)}
              </text>
            </g>
          );
        })}

        {days.map((day, i) => (
          <g key={day.date} opacity={active === null || active === i ? 1 : 0.5}>
            {stackSegments(day.values, scale).map((seg) => (
              <path
                key={seg.series}
                d={barPath(centerOf(i) - barWidth / 2, seg.top, barWidth, seg.height, seg.isTop)}
                fill={series[seg.series].color}
              />
            ))}
            {(days.length - 1 - i) % labelEvery === 0 && (
              <text x={centerOf(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--chart-muted)">
                {formatShortDate(day.date)}
              </text>
            )}
          </g>
        ))}

        {peakTotal > 0 && (
          <text
            x={centerOf(peakIndex)}
            y={BASELINE - scale(peakTotal) - 6}
            textAnchor="middle"
            fontSize={11}
            fill="var(--chart-text)"
            className="tabular-nums"
          >
            {format(peakTotal)}
          </text>
        )}

        {/* Hit targets on top: the full slot of each day, keyboard-focusable. */}
        {days.map((day, i) => (
          <rect
            key={day.date}
            x={PAD.left + slot * i}
            y={PAD.top}
            width={slot}
            height={PLOT_H}
            fill="transparent"
            tabIndex={0}
            aria-label={`${formatShortDate(day.date)}: ${series.map((s, j) => `${s.name} ${format(day.values[j])}`).join(', ')}`}
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            className="cursor-default outline-none"
          />
        ))}
      </svg>

      {peakTotal === 0 && (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
          {emptyMessage}
        </p>
      )}

      {active !== null && (
        <Tooltip
          leftPercent={(centerOf(active) / W) * 100}
          date={days[active].date}
          rows={series.map((s, j) => ({ ...s, value: format(days[active].values[j]) }))}
          total={series.length > 1 ? format(totals[active]) : undefined}
        />
      )}
    </div>
  );
}

function Tooltip({
  leftPercent,
  date,
  rows,
  total,
}: {
  leftPercent: number;
  date: string;
  rows: { name: string; color: string; value: string }[];
  total?: string;
}) {
  return (
    <div
      className="pointer-events-none absolute top-6 z-10 min-w-36 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
      style={{ left: `${Math.min(88, Math.max(12, leftPercent))}%` }}
    >
      <p className="mb-1 text-slate-500">{formatShortDate(date)}</p>
      {rows.map((row) => (
        <p key={row.name} className="flex items-center gap-2">
          <span className="h-0.5 w-3 rounded" style={{ background: row.color }} />
          <span className="font-semibold tabular-nums text-slate-900">{row.value}</span>
          <span className="text-slate-500">{row.name}</span>
        </p>
      ))}
      {total && (
        <p className="mt-1 border-t border-slate-100 pt-1 text-slate-500">
          Total <span className="font-semibold tabular-nums text-slate-900">{total}</span>
        </p>
      )}
    </div>
  );
}

/** Bottom-up segments for one column, with a surface gap between them. */
function stackSegments(values: number[], scale: (v: number) => number) {
  const visible = values.map((value, series) => ({ value, series })).filter((s) => s.value > 0);
  let stacked = 0;
  return visible.map((s, k) => {
    const bottom = BASELINE - scale(stacked);
    stacked += s.value;
    const top = BASELINE - scale(stacked);
    const gap = k > 0 ? GAP : 0;
    return { series: s.series, top, height: Math.max(0, bottom - top - gap), isTop: k === visible.length - 1 };
  });
}

/** A bar path with a rounded top (the data end) and a square base. */
function barPath(x: number, top: number, width: number, height: number, roundTop: boolean): string {
  const r = roundTop ? Math.min(RADIUS, width / 2, height) : 0;
  const bottom = top + height;
  return `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${bottom} Z`;
}

/** The smallest "nice" number (1, 2 or 5 × 10ⁿ) at or above value, for clean axis ticks. */
function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 5, 10].find((step) => step * magnitude >= value) ?? 10) * magnitude;
}
