import type {
  AnalyzeResult,
  AppSettings,
  AuthStatus,
  FeedDetail,
  FeedInput,
  FeedOptions,
  FeedSummary,
  PreviewResult,
  RecipeInfo,
  RefreshResult,
  RenderOptions,
  RequestOptions,
  SourceConfig,
  StoredItem,
  SystemInfo,
} from '../../shared/types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let unauthorizedHandler: (() => void) | null = null;

export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-glaneur': '1' };
  let payload: string | undefined;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Le serveur Glaneur ne répond pas.');
  }
  if (res.status === 401 && !url.startsWith('/api/auth/')) unauthorizedHandler?.();
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const message = data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : `Erreur ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const api = {
  authStatus: () => request<AuthStatus>('GET', '/api/auth/status'),
  setup: (password: string) => request<{ ok: true }>('POST', '/api/auth/setup', { password }),
  login: (password: string) => request<{ ok: true }>('POST', '/api/auth/login', { password }),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  changePassword: (current: string, next: string) => request<{ ok: true }>('POST', '/api/auth/password', { current, next }),

  feeds: () => request<FeedSummary[]>('GET', '/api/feeds'),
  feed: (id: string) => request<FeedDetail>('GET', `/api/feeds/${id}`),
  items: (id: string, limit = 60) => request<StoredItem[]>('GET', `/api/feeds/${id}/items?limit=${limit}`),
  createFeed: (input: FeedInput) => request<FeedDetail>('POST', '/api/feeds', input),
  updateFeed: (id: string, input: FeedInput) => request<FeedDetail>('PUT', `/api/feeds/${id}`, input),
  deleteFeed: (id: string) => request<{ ok: true }>('DELETE', `/api/feeds/${id}`),
  refreshFeed: (id: string) => request<{ result: RefreshResult; feed: FeedDetail }>('POST', `/api/feeds/${id}/refresh`),
  setEnabled: (id: string, enabled: boolean) => request<FeedDetail>('POST', `/api/feeds/${id}/enabled`, { enabled }),
  clearItems: (id: string) => request<{ ok: true }>('POST', `/api/feeds/${id}/clear`),

  preview: (source: SourceConfig, options: FeedOptions, fresh = false) =>
    request<PreviewResult>('POST', '/api/preview', { source, options, fresh }),
  analyze: (url: string, render = false) => request<AnalyzeResult>('POST', '/api/analyze', { url, render }),
  jsonSample: (source: SourceConfig, options: FeedOptions) => request<{ data: unknown }>('POST', '/api/json-sample', { source, options }),

  recipes: () => request<RecipeInfo[]>('GET', '/api/recipes'),
  buildRecipe: (id: string, params: Record<string, string | boolean>) =>
    request<{ input: FeedInput }>('POST', `/api/recipes/${id}/build`, { params }),

  settings: () => request<AppSettings>('GET', '/api/settings'),
  saveSettings: (patch: Partial<AppSettings>) => request<AppSettings>('PUT', '/api/settings', patch),
  rotateKey: () => request<{ feedKey: string }>('POST', '/api/settings/rotate-key'),
  system: () => request<SystemInfo>('GET', '/api/system'),
  importFeeds: (data: unknown) => request<{ imported: number; errors: string[] }>('POST', '/api/import', data),
};

/** URL of the sanitized page shown in the visual selector. */
export function viewUrl(url: string, render: RenderOptions, requestOptions: RequestOptions): string {
  const params = new URLSearchParams({ url, render: JSON.stringify(render), request: JSON.stringify(requestOptions) });
  return `/api/view?${params.toString()}`;
}
