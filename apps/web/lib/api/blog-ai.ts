import { api } from './client';

/**
 * Cliente do módulo Blog IA.
 * Backend: apps/api/src/modules/blog-ai/.
 */

export type BlogPostStatus =
  | 'generating'
  | 'review'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'failed'
  | 'archived';

export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  tldr: string[];
  ai_prompts: string[];
  citation_sources: Array<{ title: string; url?: string; authorOrOrg?: string; year?: number }>;
  category: string | null;
  pillar: string | null;
  tags: string[];
  cover_image_url: string | null;
  reading_time_minutes: number | null;
  status: BlogPostStatus;
  scheduled_for: string | null;
  sanity_doc_id: string | null;
  published_at: string | null;
  rejected_reason: string | null;
  source_topic: string | null;
  created_at: string;
}

export interface GenerateBlogPostInput {
  topic: string;
  pillar?: string;
  notes?: string;
  generateCover?: boolean;
}

export interface BlogTopicIdea {
  title: string;
  pillar: string;
  angle: string;
  why: string;
  aiPrompts: string[];
}

export const blogAiApi = {
  ideate: (seed?: string, count?: number) =>
    api.post<{ topics: BlogTopicIdea[] }>('/blog-ai/ideate', { seed, count }),
  generate: (input: GenerateBlogPostInput) => api.post<BlogPost>('/blog-ai/generate', input),
  list: (status?: string) => api.get<BlogPost[]>('/blog-ai/posts', { query: { status } }),
  get: (id: string) => api.get<BlogPost>(`/blog-ai/posts/${id}`),
  publish: (id: string) => api.post<BlogPost>(`/blog-ai/posts/${id}/publish`),
  reject: (id: string, reason?: string) => api.post<BlogPost>(`/blog-ai/posts/${id}/reject`, { reason }),
  schedule: (id: string, scheduledFor: string) =>
    api.post<BlogPost>(`/blog-ai/posts/${id}/schedule`, { scheduled_for: scheduledFor }),
  unschedule: (id: string) => api.post<BlogPost>(`/blog-ai/posts/${id}/unschedule`),
};

/** Pilares editoriais (slug → label PT). Taxonomia de conteúdo (fica em PT). */
export const BLOG_PILLARS: Array<{ slug: string; label: string }> = [
  { slug: 'geo-101', label: 'GEO 101' },
  { slug: 'ciencia-aplicada', label: 'Ciência aplicada' },
  { slug: 'como-fazer', label: 'Como fazer' },
  { slug: 'mudanca-de-comportamento', label: 'Mudança de comportamento' },
  { slug: 'demonstracoes', label: 'Demonstrações' },
  { slug: 'cases', label: 'Cases' },
  { slug: 'geo-brasil', label: 'GEO Brasil' },
];
