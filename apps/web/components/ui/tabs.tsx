'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Tabs minimalista controlado. Sem dependência de @radix-ui/react-tabs —
 * o projeto usa só primitives leves e esse componente cobre Tabs/TabsList/
 * TabsTrigger/TabsContent. Visual:
 *   - Underline cyan (`primary`) no trigger ativo
 *   - TabsList com scroll horizontal em mobile (`overflow-x-auto`) — em
 *     telas estreitas as abas ainda cabem mas roláveis
 *   - Conteúdo com `animate-in fade-in` (suave, sem flash) e `keep-alive`
 *     por padrão (sem unmount → preserva estado de scroll/inputs entre
 *     trocas de aba). `unmountOnHide` opcional pra forçar reset.
 *
 * Uso:
 *   <Tabs value={tab} onValueChange={setTab}>
 *     <TabsList>
 *       <TabsTrigger value="main">Principal</TabsTrigger>
 *       <TabsTrigger value="chat">Conversa</TabsTrigger>
 *     </TabsList>
 *     <TabsContent value="main">...</TabsContent>
 *     <TabsContent value="chat">...</TabsContent>
 *   </Tabs>
 */

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsCtx(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error('Tabs subcomponents must be used inside <Tabs>');
  }
  return ctx;
}

interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  children: ReactNode;
}

export function Tabs({ value, onValueChange, className, children }: TabsProps) {
  return (
    <TabsContext.Provider value={{ value, setValue: onValueChange }}>
      <div className={cn('flex flex-col', className)}>{children}</div>
    </TabsContext.Provider>
  );
}

interface TabsListProps {
  className?: string;
  children: ReactNode;
}

export function TabsList({ className, children }: TabsListProps) {
  return (
    <div
      role="tablist"
      // Scrollbar-thin gracefully em browsers modernos; oculta nas barras nas
      // demais (com ::-webkit-scrollbar custom em globals.css se quiser).
      className={cn(
        'flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border',
        '[scrollbar-width:thin]',
        className,
      )}
    >
      {children}
    </div>
  );
}

interface TabsTriggerProps {
  value: string;
  className?: string;
  disabled?: boolean;
  children: ReactNode;
}

export function TabsTrigger({ value, className, disabled, children }: TabsTriggerProps) {
  const ctx = useTabsCtx();
  const active = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={() => ctx.setValue(value)}
      className={cn(
        // Underline animado: borda 2px na base, vira primary (cyan) quando ativo
        'relative inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-none border-b-2 border-transparent px-3 text-xs font-medium transition-colors',
        active
          ? 'border-primary text-primary'
          : 'text-muted-foreground hover:text-foreground',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      {children}
    </button>
  );
}

interface TabsContentProps {
  value: string;
  className?: string;
  /**
   * Quando true, monta o conteúdo só quando ativo (sem keep-alive).
   * Default: false — mantém todos os panels montados, melhor UX
   * (preserva scroll/inputs ao trocar de aba).
   */
  unmountOnHide?: boolean;
  children: ReactNode;
}

export function TabsContent({
  value,
  className,
  unmountOnHide = false,
  children,
}: TabsContentProps) {
  const ctx = useTabsCtx();
  const active = ctx.value === value;
  if (unmountOnHide && !active) return null;
  return (
    <div
      role="tabpanel"
      hidden={!active}
      // Animação fade suave ao mudar — `animate-in` da tailwindcss-animate.
      // Reaplica a cada mudança usando `key={ctx.value}` no parent NÃO é
      // necessário; o data-active vira true e o re-render dispara o animation.
      data-active={active}
      className={cn(
        active
          ? 'flex flex-1 flex-col animate-in fade-in-0 duration-200'
          : 'hidden',
        className,
      )}
    >
      {children}
    </div>
  );
}
