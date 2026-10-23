import { readErrorMessage } from './api';

/**
 * POSTs JSON and reads the Server-Sent Events response as it streams in.
 * (The browser's EventSource only supports GET, so we parse the frames from
 * the fetch() body ourselves: frames are "event: x\ndata: {...}" separated by a blank line.)
 */
export async function postEventStream(
  url: string,
  body: unknown,
  onEvent: (event: string, data: any) => void,
  { signal, headers = {} }: { signal?: AbortSignal; headers?: Record<string, string> } = {},
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  });
  // Errors before the stream starts (validation, auth, rate limits) are plain JSON.
  if (!res.ok || !res.body) throw new Error(await readErrorMessage(res));

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;

    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = /^event: (.*)$/m.exec(frame)?.[1] ?? 'message';
      const data = /^data: (.*)$/m.exec(frame)?.[1];
      if (data) onEvent(event, JSON.parse(data));
    }
  }
}
