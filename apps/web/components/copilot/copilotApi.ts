/**
 * Client do Copiloto Flutuante v1. Espelha a API do CopilotHelpController:
 *   GET  /copilot/route-context?pathname=
 *   POST /copilot/help                 { pathname, question, history? }
 *   GET  /copilot/kb
 *   POST /copilot/feedback             { pathname, question, answer, rating, comment? }
 *
 * Auth (Supabase Bearer) já é injetado pelo `lib/api/client.ts` — não
 * precisamos repetir aqui.
 */

import { api } from '@/lib/api/client';

export interface KbEntry {
  routes: string[];
  category: string;
  title: string;
  content: string;
  tags?: string[];
}

export interface RouteContext {
  entries: KbEntry[];
  total_kb_size: number;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface HelpResponse {
  answer: string;
  matched_kb: number;
  cost_usd: number;
}

export const copilotApi = {
  getRouteContext(pathname: string, signal?: AbortSignal): Promise<RouteContext> {
    return api.get<RouteContext>('/copilot/route-context', {
      query: { pathname },
      ...(signal ? { signal } : {}),
    });
  },

  ask(args: {
    pathname: string;
    question: string;
    history?: ChatTurn[];
  }): Promise<HelpResponse> {
    return api.post<HelpResponse>('/copilot/help', {
      pathname: args.pathname,
      question: args.question,
      ...(args.history ? { history: args.history } : {}),
    });
  },

  listKb(signal?: AbortSignal): Promise<Record<string, KbEntry[]>> {
    return api.get<Record<string, KbEntry[]>>(
      '/copilot/kb',
      signal ? { signal } : undefined,
    );
  },

  feedback(args: {
    pathname: string;
    question: string;
    answer: string;
    rating: 'up' | 'down';
    comment?: string;
  }): Promise<void> {
    return api.post<void>('/copilot/feedback', args);
  },
};
