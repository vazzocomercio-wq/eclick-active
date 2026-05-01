'use client';

import { useEffect, useRef, useState } from 'react';

interface CountUpProps {
  value: number;
  /** Casas decimais (default 0) */
  decimals?: number;
  /** Duração da animação em ms (default 600) */
  duration?: number;
}

/**
 * Anima o número de 0 (ou do valor anterior) até `value` em `duration` ms.
 * Usa requestAnimationFrame com easing easeOutQuart.
 */
export function CountUp({ value, decimals = 0, duration = 600 }: CountUpProps) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    fromRef.current = display;
    startRef.current = null;

    const target = value;
    const from = fromRef.current;

    function tick(ts: number) {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const progress = Math.min(1, elapsed / duration);
      // easeOutQuart
      const eased = 1 - Math.pow(1 - progress, 4);
      const current = from + (target - from) * eased;
      setDisplay(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return <>{display.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</>;
}
