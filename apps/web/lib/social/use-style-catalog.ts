'use client';

import { useEffect, useState } from 'react';
import { socialApi, type PromptOverride } from '@/lib/api/social';
import {
  VIDEO_STYLES,
  SCRIPT_FRAMEWORKS,
  type VideoStyle,
  type ScriptFramework,
} from '@/lib/social/video-styles';

/**
 * Catálogo de estilos/frameworks com os OVERRIDES do Estúdio de Estilos
 * aplicados sobre o catálogo do código. Use no lugar de importar
 * VIDEO_STYLES/findStyle direto, pra geração respeitar o que foi editado.
 */
export function useStyleCatalog() {
  const [overrides, setOverrides] = useState<PromptOverride[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    socialApi.prompts
      .list(ctrl.signal)
      .then(setOverrides)
      .catch(() => {})
      .finally(() => setLoaded(true));
    return () => ctrl.abort();
  }, []);

  const styleOv = new Map(
    overrides.filter((o) => o.kind === 'video_style' && o.is_active).map((o) => [o.key, o]),
  );
  const fwOv = new Map(
    overrides.filter((o) => o.kind === 'framework' && o.is_active).map((o) => [o.key, o]),
  );

  const styles: VideoStyle[] = VIDEO_STYLES.map((s) => {
    const o = styleOv.get(s.id);
    return o
      ? {
          ...s,
          label: o.label || s.label,
          hint: o.prompt || s.hint,
          camera: (o.camera as VideoStyle['camera']) || s.camera,
        }
      : s;
  });
  for (const o of styleOv.values()) {
    if (!VIDEO_STYLES.some((s) => s.id === o.key)) {
      styles.push({
        id: o.key,
        label: o.label || o.key,
        group: 'tipo',
        tier: 'experimental',
        hint: o.prompt,
        camera: (o.camera as VideoStyle['camera']) || undefined,
      });
    }
  }

  const frameworks: ScriptFramework[] = SCRIPT_FRAMEWORKS.map((f) => {
    const o = fwOv.get(f.id);
    return o ? { ...f, label: o.label || f.label, hint: o.prompt || f.hint } : f;
  });
  for (const o of fwOv.values()) {
    if (!SCRIPT_FRAMEWORKS.some((f) => f.id === o.key)) {
      frameworks.push({ id: o.key, label: o.label || o.key, hint: o.prompt });
    }
  }

  return {
    loaded,
    styles,
    frameworks,
    findStyle: (id?: string | null) => (id ? styles.find((s) => s.id === id) : undefined),
    findFramework: (id?: string | null) =>
      id ? frameworks.find((f) => f.id === id) : undefined,
  };
}
