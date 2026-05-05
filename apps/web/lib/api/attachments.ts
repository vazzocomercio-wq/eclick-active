import { api } from './client';

export interface ConversationAttachment {
  id: string;
  message_id: string;
  media_type: 'image' | 'audio' | 'video' | 'document';
  mime_type: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  ai_summary: string | null;
  ai_extracted: Record<string, unknown> | null;
  url: string | null;
  /** Status interno: 'downloading' | 'uploaded' | 'download_failed' | 'upload_failed' | null (legacy) */
  status?: string | null;
  /** Mensagem de erro quando status terminou em '*_failed' */
  error?: string | null;
  created_at: string;
}

export const attachmentsApi = {
  forConversation(conversationId: string, signal?: AbortSignal) {
    return api.get<ConversationAttachment[]>(
      `/attachments/conversation/${conversationId}`,
      { signal },
    );
  },
};
