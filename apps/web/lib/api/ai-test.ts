import type { AiTestConversation, AiTestMessage } from '@eclick-active/shared';
import { api } from './client';

export const aiTestApi = {
  listSessions(signal?: AbortSignal): Promise<AiTestConversation[]> {
    return api.get<AiTestConversation[]>('/ai/test/sessions', { signal });
  },
  createSession(personaId?: string): Promise<AiTestConversation> {
    return api.post<AiTestConversation>('/ai/test/sessions', {
      ...(personaId ? { persona_id: personaId } : {}),
    });
  },
  getSession(id: string, signal?: AbortSignal): Promise<AiTestConversation> {
    return api.get<AiTestConversation>(`/ai/test/sessions/${id}`, { signal });
  },
  sendMessage(
    sessionId: string,
    content: string,
  ): Promise<{ session: AiTestConversation; reply: AiTestMessage }> {
    return api.post<{ session: AiTestConversation; reply: AiTestMessage }>(
      `/ai/test/sessions/${sessionId}/message`,
      { content },
    );
  },
  deleteSession(id: string): Promise<void> {
    return api.delete<void>(`/ai/test/sessions/${id}`);
  },
};
