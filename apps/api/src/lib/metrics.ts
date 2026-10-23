// In-process metrics, exposed at GET /metrics in Prometheus text format. Each API
// instance keeps its own numbers; a Prometheus server scrapes every instance and
// sums them. Small and dependency-free on purpose: a handful of counters plus
// rolling windows for percentiles.

/** Keeps the most recent `size` values, for percentiles over recent traffic. */
class RollingWindow {
  private values: number[] = [];
  constructor(private readonly size: number) {}

  add(value: number) {
    this.values.push(value);
    if (this.values.length > this.size) this.values.shift();
  }

  percentile(p: number): number {
    if (this.values.length === 0) return 0;
    const sorted = [...this.values].sort((a, b) => a - b);
    return sorted[Math.ceil(p * sorted.length) - 1];
  }
}

const requests: Record<string, number> = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
const chatAnswers = { hit: 0, miss: 0 };
const requestDurations = new RollingWindow(1_000);
const chatDurations = new RollingWindow(500);

export function recordRequest(status: number, durationMs: number): void {
  requests[`${Math.floor(status / 100)}xx`] = (requests[`${Math.floor(status / 100)}xx`] ?? 0) + 1;
  requestDurations.add(durationMs);
}

export function recordChatAnswer(cacheHit: boolean, durationMs: number): void {
  chatAnswers[cacheHit ? 'hit' : 'miss']++;
  chatDurations.add(durationMs);
}

/** Renders the in-process metrics plus any gauges read at scrape time (e.g. queue depth). */
export function renderMetrics(queueJobs: Record<string, number>): string {
  const answered = chatAnswers.hit + chatAnswers.miss;
  const lines = [
    '# HELP docspilot_http_requests_total HTTP requests handled, by status class (excludes /health and /metrics).',
    '# TYPE docspilot_http_requests_total counter',
    ...Object.entries(requests).map(([status, n]) => `docspilot_http_requests_total{status="${status}"} ${n}`),
    '# HELP docspilot_http_errors_total Requests that failed on our side (5xx).',
    '# TYPE docspilot_http_errors_total counter',
    `docspilot_http_errors_total ${requests['5xx']}`,
    '# HELP docspilot_http_request_duration_p95_ms 95th percentile duration of the last 1000 requests (chat streams included).',
    '# TYPE docspilot_http_request_duration_p95_ms gauge',
    `docspilot_http_request_duration_p95_ms ${Math.round(requestDurations.percentile(0.95))}`,
    '# HELP docspilot_chat_answers_total Chat answers, by response-cache result.',
    '# TYPE docspilot_chat_answers_total counter',
    `docspilot_chat_answers_total{cache="hit"} ${chatAnswers.hit}`,
    `docspilot_chat_answers_total{cache="miss"} ${chatAnswers.miss}`,
    '# HELP docspilot_chat_cache_hit_ratio Share of chat answers served from the response cache.',
    '# TYPE docspilot_chat_cache_hit_ratio gauge',
    `docspilot_chat_cache_hit_ratio ${answered ? (chatAnswers.hit / answered).toFixed(3) : 0}`,
    '# HELP docspilot_chat_answer_duration_p95_ms 95th percentile time to a complete answer (last 500 answers).',
    '# TYPE docspilot_chat_answer_duration_p95_ms gauge',
    `docspilot_chat_answer_duration_p95_ms ${Math.round(chatDurations.percentile(0.95))}`,
    '# HELP docspilot_ingest_queue_jobs Ingestion jobs in the queue, by state.',
    '# TYPE docspilot_ingest_queue_jobs gauge',
    ...Object.entries(queueJobs).map(([state, n]) => `docspilot_ingest_queue_jobs{state="${state}"} ${n}`),
  ];
  return `${lines.join('\n')}\n`;
}
