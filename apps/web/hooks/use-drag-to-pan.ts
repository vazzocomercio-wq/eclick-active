'use client';

import { useCallback, useRef } from 'react';

interface UseDragToPanOptions {
  /**
   * Selector CSS de elementos que NÃO devem disparar pan ao receber
   * pointerdown. Default cobre só elementos interativos NATIVOS — não
   * filtra `[role="button"]` porque alguns containers internos (Radix
   * ScrollArea, etc.) podem ter esse role e bloqueariam pan demais.
   * Cards do dnd-kit não conflitam porque dnd-kit ativa drag em 6px e
   * nosso threshold default é 10px — dá ao dnd-kit prioridade.
   * Adicione `[data-no-pan]` em algum filho pra escape manual.
   */
  ignore?: string;
  /**
   * Distância em px que o pointer precisa percorrer antes do pan ativar.
   * Default: 10 (margem confortável > activation distance do dnd-kit
   * PointerSensor=6 pra evitar conflito quando o pointer começa num card).
   */
  threshold?: number;
}

/**
 * Hook pra adicionar "drag-to-pan" (clicar e arrastar pra mover scroll
 * horizontal) em um container scrollável — útil em kanbans largos onde
 * algumas colunas ficam fora da viewport.
 *
 * Uso:
 *   const panRef = useDragToPan<HTMLDivElement>();
 *   <div ref={panRef} className="overflow-x-auto cursor-grab"> ... </div>
 *
 * Suporta mouse + touch + pen via Pointer Events (responsivo por default).
 *
 * Nota: retorna uma **callback ref** (função). React chama essa função
 * quando o elemento é montado/desmontado. Isso evita o bug clássico do
 * useEffect-com-useRef quando o elemento é renderizado condicionalmente
 * (ex: dentro de `{!loading && <div ref={...}>}`) — useEffect rodaria
 * antes do elemento existir e nunca re-rodaria depois.
 */
export function useDragToPan<T extends HTMLElement = HTMLElement>(
  opts: UseDragToPanOptions = {},
) {
  const ignore =
    opts.ignore ??
    'button, a, input, textarea, select, [contenteditable="true"], [data-no-pan]';
  const threshold = opts.threshold ?? 10;
  const cleanupRef = useRef<(() => void) | null>(null);

  return useCallback(
    (el: T | null) => {
      // Cleanup do elemento anterior (se houve troca/unmount)
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      if (!el) {
        // eslint-disable-next-line no-console
        console.log('[pan] callback ref — elemento desmontou');
        return;
      }
      // eslint-disable-next-line no-console
      console.log('[pan] callback ref — listeners atachados em', el.tagName, el.className);

      let active = false;
      let pointerId: number | null = null;
      let startX = 0;
      let startScroll = 0;
      let exceededThreshold = false;

      function onPointerDown(e: PointerEvent) {
        // Mouse: só botão primário. Touch/pen: qualquer.
        if (e.pointerType === 'mouse' && e.button !== 0) {
          // eslint-disable-next-line no-console
          console.log('[pan] skip — non-primary button', e.button);
          return;
        }
        const target = e.target as HTMLElement | null;
        const matched = target && target.closest(ignore);
        if (matched) {
          // eslint-disable-next-line no-console
          console.log('[pan] skip — matched ignore selector', matched.tagName, (matched as HTMLElement).className);
          return;
        }
        active = true;
        pointerId = e.pointerId;
        startX = e.clientX;
        startScroll = el!.scrollLeft;
        exceededThreshold = false;
        // eslint-disable-next-line no-console
        console.log('[pan] pointerdown OK', { type: e.pointerType, x: e.clientX, scrollLeft: startScroll });
      }

      function onPointerMove(e: PointerEvent) {
        if (!active || pointerId !== e.pointerId) return;
        const dx = e.clientX - startX;
        if (!exceededThreshold) {
          if (Math.abs(dx) < threshold) return;
          exceededThreshold = true;
          // eslint-disable-next-line no-console
          console.log('[pan] threshold exceeded — pan ATIVADO', { dx });
          // Captura o pointer pra continuar recebendo moves mesmo se sair
          try {
            el!.setPointerCapture(pointerId);
          } catch {
            /* setPointerCapture pode falhar se outro elemento já capturou */
          }
          el!.style.cursor = 'grabbing';
          document.body.style.userSelect = 'none';
          // Limpa qualquer seleção de texto que tenha começado nos primeiros
          // px antes de exceder o threshold
          try {
            window.getSelection()?.removeAllRanges();
          } catch {
            /* noop */
          }
        }
        el!.scrollLeft = startScroll - dx;
        // Previne text selection durante drag
        e.preventDefault();
      }

      function release(e?: PointerEvent) {
        if (!active) return;
        active = false;
        const pid = pointerId;
        pointerId = null;
        const wasPanning = exceededThreshold;
        exceededThreshold = false;
        el!.style.cursor = '';
        document.body.style.userSelect = '';
        if (pid !== null && el!.hasPointerCapture(pid)) {
          try {
            el!.releasePointerCapture(pid);
          } catch {
            /* noop */
          }
        }
        // Suprime o event original quando estávamos panando — evita que
        // o pointerup no fundo dispare cliques residuais.
        if (e && wasPanning) {
          e.preventDefault();
        }
      }

      // capture: true pra pegar pointer events ANTES de filhos que tenham
      // listeners próprios (Radix ScrollArea, dnd-kit, etc.). Sem isso o
      // ScrollArea de cada coluna interceptaria e o pan nunca ativava.
      const listenerOpts = { capture: true } as const;
      el.addEventListener('pointerdown', onPointerDown, listenerOpts);
      el.addEventListener('pointermove', onPointerMove, listenerOpts);
      el.addEventListener('pointerup', release, listenerOpts);
      el.addEventListener('pointercancel', release, listenerOpts);
      el.addEventListener('pointerleave', release, listenerOpts);

      cleanupRef.current = () => {
        el.removeEventListener('pointerdown', onPointerDown, listenerOpts);
        el.removeEventListener('pointermove', onPointerMove, listenerOpts);
        el.removeEventListener('pointerup', release, listenerOpts);
        el.removeEventListener('pointercancel', release, listenerOpts);
        el.removeEventListener('pointerleave', release, listenerOpts);
        // Reset estilos caso o componente desmonte mid-drag
        el.style.cursor = '';
        document.body.style.userSelect = '';
      };
    },
    [ignore, threshold],
  );
}
