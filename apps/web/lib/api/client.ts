import { createClient } from '../supabase/client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions {
  query?: Record<string, string | number | string[] | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

async function buildHeaders(isMultipart: boolean): Promise<HeadersInit> {
  // Pra FormData, deixa o browser setar Content-Type com boundary automático.
  const headers: Record<string, string> = isMultipart
    ? {}
    : { 'Content-Type': 'application/json' };
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // Sem env Supabase configurada — segue sem header (api retorna 401).
    // Quando rodar com auth completa, o middleware redireciona pro /login
    // antes mesmo de chegar aqui.
  }
  return headers;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path, API_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === '') continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, v);
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = buildUrl(path, options.query);
  const isMultipart =
    typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = await buildHeaders(isMultipart);

  const res = await fetch(url, {
    method,
    headers,
    body:
      options.body === undefined
        ? undefined
        : isMultipart
          ? (options.body as FormData)
          : JSON.stringify(options.body),
    signal: options.signal,
  });

  let body: unknown = null;
  if (res.status !== 204) {
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
  }

  if (!res.ok) {
    // BYOK: 402 ai_key_required → avisa o guard global (modal "Conecte sua
    // chave de IA"). Sem precisar migrar call-sites.
    if (
      res.status === 402 &&
      typeof body === 'object' &&
      body &&
      (body as { error?: unknown }).error === 'ai_key_required' &&
      typeof window !== 'undefined'
    ) {
      const detail = body as { provider?: string; message?: string };
      window.dispatchEvent(new CustomEvent('eclick:ai-key-required', { detail }));
    }
    const message =
      typeof body === 'object' && body && 'message' in body
        ? String((body as { message: unknown }).message)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, message, body);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PUT', path, { ...options, body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>('DELETE', path, options),
};
