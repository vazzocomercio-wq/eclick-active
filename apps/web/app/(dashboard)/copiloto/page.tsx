'use client';

import { CopilotPanel } from '@/components/copilot/copilot-panel';

/**
 * Página /copiloto — só hospeda o painel canônico em modo full. Toda a
 * lógica vive em `CopilotPanel`, que é reutilizado em drawers/sidebars
 * com `compact=true` e contexto contextual (deal/contact/conversation).
 */
export default function CopilotoPage() {
  return <CopilotPanel contextType="general" compact={false} />;
}
