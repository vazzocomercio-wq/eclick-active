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

export interface BlogSettings {
  voice_guidelines: string | null;
}

export type BlogPromptKey = 'article' | 'ideate';

export interface BlogPrompt {
  id: string;
  key: BlogPromptKey;
  prompt: string;
  is_active: boolean;
  is_default: boolean;
}

export interface BlogKnowledgeSource {
  id: string;
  source_type: 'url' | 'text' | 'image';
  value: string;
  title: string | null;
  extracted_text: string | null;
  is_active: boolean;
  created_at: string;
}

export const blogAiApi = {
  getSettings: () => api.get<BlogSettings>('/blog-ai/settings'),
  saveSettings: (voice_guidelines: string | null) =>
    api.put<BlogSettings>('/blog-ai/settings', { voice_guidelines }),

  // Estúdio: prompts editáveis
  listPrompts: () => api.get<BlogPrompt[]>('/blog-ai/studio/prompts'),
  savePrompt: (key: BlogPromptKey, prompt: string) =>
    api.put<BlogPrompt>(`/blog-ai/studio/prompts/${key}`, { prompt }),
  resetPrompt: (key: BlogPromptKey) => api.delete<void>(`/blog-ai/studio/prompts/${key}`),
  generatePrompt: (key: BlogPromptKey, instruction: string, current_prompt?: string) =>
    api.post<{ prompt: string }>(`/blog-ai/studio/prompts/${key}/generate`, { instruction, current_prompt }),

  // Estúdio: base de conhecimento
  listKnowledge: () => api.get<BlogKnowledgeSource[]>('/blog-ai/studio/knowledge'),
  addKnowledge: (source_type: 'url' | 'text' | 'image', value: string, title?: string) =>
    api.post<BlogKnowledgeSource>('/blog-ai/studio/knowledge', { source_type, value, title }),
  removeKnowledge: (id: string) => api.delete<void>(`/blog-ai/studio/knowledge/${id}`),
  ideate: (seed?: string, count?: number) =>
    api.post<{ topics: BlogTopicIdea[] }>('/blog-ai/ideate', { seed, count }),
  generateBatch: (seed?: string, count?: number) =>
    api.post<BlogPost[]>('/blog-ai/generate-batch', { seed, count }),
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
