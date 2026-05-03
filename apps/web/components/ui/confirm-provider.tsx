'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';
import { cn } from '@/lib/utils';

/**
 * API imperativa de confirm/prompt — substitui `window.confirm` e
 * `window.prompt` mantendo o tema do app (dark/light, cyan).
 *
 * Uso:
 *   const confirm = useConfirm();
 *   const prompt = usePrompt();
 *
 *   if (!await confirm({ title: 'Excluir?', variant: 'destructive' })) return;
 *
 *   const reason = await prompt({ title: 'Motivo:', placeholder: '...' });
 *   if (reason === null) return; // user cancelou
 *
 * Mount uma única vez em `(dashboard)/layout.tsx` envolvendo o conteúdo.
 */

// ────────────────────────────────────────────────────────────
// Confirm
// ────────────────────────────────────────────────────────────

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  icon?: LucideIcon;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

// ────────────────────────────────────────────────────────────
// Prompt
// ────────────────────────────────────────────────────────────

export interface PromptOptions {
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Valida o valor — retorna mensagem de erro ou null se OK. */
  validate?: (value: string) => string | null;
  /** Aceita string vazia? Default false. */
  allowEmpty?: boolean;
  /** Tipo do input — default 'text'. */
  type?: 'text' | 'password' | 'email' | 'url' | 'number' | 'datetime-local';
  /** Renderiza como textarea (multiline) em vez de input. */
  multiline?: boolean;
}

interface PromptState extends PromptOptions {
  resolve: (value: string | null) => void;
}

// ────────────────────────────────────────────────────────────
// Context
// ────────────────────────────────────────────────────────────

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm() requer <ConfirmProvider> no tree.');
  }
  return ctx.confirm;
}

export function usePrompt(): (opts: PromptOptions) => Promise<string | null> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('usePrompt() requer <ConfirmProvider> no tree.');
  }
  return ctx.prompt;
}

// ────────────────────────────────────────────────────────────
// Provider
// ────────────────────────────────────────────────────────────

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...opts, resolve });
    });
  }, []);

  const prompt = useCallback((opts: PromptOptions): Promise<string | null> => {
    return new Promise<string | null>((resolve) => {
      setPromptState({ ...opts, resolve });
    });
  }, []);

  const value = useMemo<ConfirmContextValue>(
    () => ({ confirm, prompt }),
    [confirm, prompt],
  );

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmRenderer
        state={confirmState}
        close={(ok) => {
          confirmState?.resolve(ok);
          setConfirmState(null);
        }}
      />
      <PromptRenderer
        state={promptState}
        close={(value) => {
          promptState?.resolve(value);
          setPromptState(null);
        }}
      />
    </ConfirmContext.Provider>
  );
}

// ────────────────────────────────────────────────────────────
// Confirm dialog
// ────────────────────────────────────────────────────────────

function ConfirmRenderer({
  state,
  close,
}: {
  state: ConfirmState | null;
  close: (ok: boolean) => void;
}) {
  const open = state !== null;
  const Icon = state?.icon;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {Icon && (
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                  state?.variant === 'destructive'
                    ? 'bg-destructive/15 text-destructive'
                    : 'bg-primary/15 text-primary',
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
            )}
            <span>{state?.title}</span>
          </DialogTitle>
          {state?.description && (
            <DialogDescription className="pt-1.5 leading-relaxed">
              {state.description}
            </DialogDescription>
          )}
        </DialogHeader>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {state?.cancelLabel ?? 'Cancelar'}
          </Button>
          <Button
            type="button"
            onClick={() => close(true)}
            variant={state?.variant === 'destructive' ? 'destructive' : 'default'}
          >
            {state?.confirmLabel ?? 'Confirmar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────
// Prompt dialog
// ────────────────────────────────────────────────────────────

function PromptRenderer({
  state,
  close,
}: {
  state: PromptState | null;
  close: (value: string | null) => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastStateRef = useRef<PromptState | null>(null);

  // Reseta o input quando abre um novo prompt
  if (state && state !== lastStateRef.current) {
    lastStateRef.current = state;
    setValue(state.defaultValue ?? '');
    setError(null);
    setBusy(false);
  }
  if (!state && lastStateRef.current !== null) {
    lastStateRef.current = null;
  }

  const open = state !== null;

  function handleConfirm() {
    if (!state) return;
    const trimmed = value.trim();
    if (!state.allowEmpty && !trimmed) {
      setError('Campo obrigatório');
      return;
    }
    if (state.validate) {
      const err = state.validate(value);
      if (err) {
        setError(err);
        return;
      }
    }
    setBusy(true);
    close(value);
  }

  function handleCancel() {
    close(null);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{state?.title}</DialogTitle>
          {state?.description && (
            <DialogDescription className="pt-1.5 leading-relaxed">
              {state.description}
            </DialogDescription>
          )}
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleConfirm();
          }}
          className="flex flex-col gap-2"
        >
          <Label htmlFor="prompt-input" className="text-xs">
            {state?.placeholder ?? 'Digite aqui'}
          </Label>
          {state?.multiline ? (
            <textarea
              id="prompt-input"
              autoFocus
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              placeholder={state?.placeholder}
              rows={4}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          ) : (
            <Input
              id="prompt-input"
              autoFocus
              type={state?.type ?? 'text'}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              placeholder={state?.placeholder}
            />
          )}
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          <DialogFooter className="mt-3">
            <Button type="button" variant="outline" onClick={handleCancel}>
              {state?.cancelLabel ?? 'Cancelar'}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {state?.confirmLabel ?? 'OK'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
