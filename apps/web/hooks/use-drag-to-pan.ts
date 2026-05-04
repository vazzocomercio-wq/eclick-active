'use client';

import { useEffect, useRef } from 'react';

interface UseDragToPanOptions {
  /**
   * Selector CSS de elementos que NÃO devem disparar pan ao receber
   * pointerdown. Default cobre: botões, links, inputs, e qualquer coisa
   * com role="button" (dnd-kit aplica isso nos itens draggable).
   * Adicione `[data-no-pan]` em algum filho pra escape manual.
   */
  ignore?: string;
  /**
   * Distância em px que o pointer precisa percorrer antes do pan ativar.
   * Default: 8 (maior que activation distance do dnd-kit PointerSensor=6
   * pra evitar conflito quando o pointer começa num card).
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
 */
export function useDragToPan<T extends HTMLElement = HTMLElement>(
  opts: UseDragToPanOptions = {},
) {
  const ref = useRef<T | null>(null);
  const ignore =
    opts.ignore ??
    'button, a, input, textarea, select, [data-no-pan], [role="button"]';
  const threshold = opts.threshold ?? 8;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let active = false;
    let pointerId: number | null = null;
    let startX = 0;
    let startScroll = 0;
    let exceededThreshold = false;

    function onPointerDown(e: PointerEvent) {
      // Mouse: só botão primário. Touch/pen: qualquer.
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest(ignore)) return;
      active = true;
      pointerId = e.pointerId;
      startX = e.clientX;
      startScroll = el!.scrollLeft;
      exceededThreshold = false;
    }

    function onPointerMove(e: PointerEvent) {
      if (!active || pointerId !== e.pointerId) return;
      const dx = e.clientX - startX;
      if (!exceededThreshold) {
        if (Math.abs(dx) < threshold) return;
        exceededThreshold = true;
        // Captura o pointer pra continuar recebendo moves mesmo se sair
        try {
          el!.setPointerCapture(pointerId);
        } catch {
          /* setPointerCapture pode falhar se outro elemento já capturou */
        }
        el!.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
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
      if (e && exceededThreshold) {
        e.preventDefault();
      }
    }

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', release);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', release);
      el.removeEventListener('pointercancel', release);
      el.removeEventListener('pointerleave', release);
      // Reset estilos caso o componente desmonte mid-drag
      el.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [ignore, threshold]);

  return ref;
}
