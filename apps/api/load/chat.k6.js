// k6 load test for the chat endpoint.
//
//   docker run --rm -i --network docspilot_default -e BASE_URL=http://api:4000 \
//     grafana/k6 run - < apps/api/load/chat.k6.js
//
// Start the API with high rate limits first, or you're load-testing the limiter:
//   RATE_LIMIT_IP_PER_MIN=1000000 RATE_LIMIT_TENANT_PER_MIN=1000000 docker compose up -d api
//
// With the default mock providers this measures DocsPilot itself (auth, Redis,
// Postgres + pgvector, streaming), not LLM latency.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const cachedAnswer = new Trend('chat_cached_ms', true);
const generatedAnswer = new Trend('chat_generated_ms', true);

// Sized to stay under one tenant's default 1,000 messages/month: a longer run gets
// 402 PLAN_LIMIT_REACHED once the quota is used (which is the quota working).
export const options = {
  scenarios: {
    chat: { executor: 'ramping-vus', stages: [
      { duration: '10s', target: 12 },
      { duration: '30s', target: 12 },
      { duration: '5s', target: 0 },
    ] },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    chat_cached_ms: ['p(95)<300'],
  },
};

const QUESTIONS = [
  'How long do refunds take?',
  'How long does shipping take?',
  'Can I return opened items?',
  'Do you ship internationally?',
];

const POLICY = `Refunds are processed within 5 business days after we receive the item.
Shipping takes 3 to 7 business days. Express shipping arrives in 1 to 2 days.
Opened items can be returned within 30 days if they are undamaged.
We ship internationally to over 40 countries.`;

// One fresh tenant per run (fresh monthly quota), using a secret API key.
export function setup() {
  const email = `load-${Date.now()}@example.test`;
  const signup = http.post(`${BASE_URL}/api/auth/signup`, JSON.stringify({
    companyName: 'Load Test Co', email, password: 'load-test-password',
  }), { headers: { 'Content-Type': 'application/json' } });
  check(signup, { 'signed up': (r) => r.status === 201 });

  // In production the session cookie is Secure (HTTPS-only), so k6 won't resend it
  // over plain http://api:4000 by itself; pass it explicitly.
  const session = `dp_session=${signup.cookies.dp_session[0].value}`;
  const key = http.post(`${BASE_URL}/api/tenant/secret-key`, null, { headers: { Cookie: session } }).json('secretKey');
  const auth = { Authorization: `Bearer ${key}` };
  http.post(`${BASE_URL}/api/documents`, { file: http.file(POLICY, 'policy.txt', 'text/plain') }, { headers: auth });
  for (let i = 0; i < 50; i++) {
    if (http.get(`${BASE_URL}/api/documents`, { headers: auth }).json('documents.0.status') === 'ready') break;
    sleep(0.2);
  }
  return { key };
}

export default function ({ key }) {
  // Half repeat a few common questions (cache hits after the first), half are unique (misses).
  const unique = Math.random() < 0.5;
  const base = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
  const message = unique ? `${base} (case ${__VU}-${__ITER})` : base;

  const res = http.post(`${BASE_URL}/api/chat`, JSON.stringify({ message }), {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    timeout: '30s',
  });
  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'stream finished': (r) => typeof r.body === 'string' && r.body.includes('event: done'),
  });
  if (ok) {
    const cached = res.body.includes('"cached":true');
    (cached ? cachedAnswer : generatedAnswer).add(res.timings.duration);
  }
  sleep(0.5);
}
