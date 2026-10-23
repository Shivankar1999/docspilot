// Browser-side API calls. Paths start with /api, which Next.js proxies to Express
// (see next.config.ts), so the session cookie is sent automatically.
export async function apiRequest<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  // FormData (file uploads) goes as-is: the browser sets the multipart content type.
  const isForm = options.body instanceof FormData;
  const isJson = options.body !== undefined && !isForm;
  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers: isJson ? { 'content-type': 'application/json' } : undefined,
    body: isForm ? (options.body as FormData) : isJson ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// Turns the API's { error: { message, details } } shape into one readable sentence.
export async function readErrorMessage(res: Response): Promise<string> {
  try {
    const { error } = await res.json();
    return error?.details?.[0]?.message ?? error?.message ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}
