'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type {
  CustomFieldDefinition,
  CustomFieldEntityType,
  CustomFieldGroup,
} from '@eclick-active/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { customFieldsApi } from '@/lib/api/custom-fields';
import { ApiError } from '@/lib/api/client';
import { CustomFieldRenderer } from './custom-field-renderer';
import { cn } from '@/lib/utils';

const NO_GROUP_KEY = '__none__';

export interface CustomFieldsSectionProps {
  entityType: CustomFieldEntityType;
  /** Valor atual de `entity.custom_fields` (jsonb). Pode estar vazio. */
  values: Record<string, unknown>;
  /**
   * Salva um patch parcial de `custom_fields` no backend (recebe só as
   * keys que mudaram). O caller tipicamente chama `entityApi.update(id, { custom_fields: nextFull })`.
   */
  onSave: (nextFullJson: Record<string, unknown>) => Promise<void>;
  /**
   * Quando passado, campos text/textarea/email/url ganham botão ✨
   * "Preencher com IA". Tipicamente `{ entityType: 'deal', entityId: deal.id }`.
   */
  entityId?: string;
  className?: string;
}

/**
 * Renderiza os campos personalizados de uma entidade (deal/contact/company),
 * agrupados pelo `group_id` da definition. Campos sem grupo viram seção
 * "Principal" (que cobre o caso comum onde a org não tem grupos cadastrados).
 *
 * Comportamento:
 *   - Busca `definitions` + `groups` da org via `customFieldsApi`
 *   - Mantém o estado local em `localValues`; debounce de 800ms desde a
 *     última edição dispara o save remoto via `onSave`
 *   - Mostra spinner discreto no canto durante save
 *   - Tolera defs ainda não carregadas (skeleton) e org sem campos (renderiza nada)
 */
export function CustomFieldsSection({
  entityType,
  values,
  onSave,
  entityId,
  className,
}: CustomFieldsSectionProps) {
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[] | null>(null);
  const [groups, setGroups] = useState<CustomFieldGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Estado local debounced — fonte de verdade pro renderer enquanto o user digita
  const [localValues, setLocalValues] = useState<Record<string, unknown>>(values);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const dirtyRef = useRef(false);

  // Sync inicial + quando props.values mudar (ex: reload externo)
  useEffect(() => {
    if (!dirtyRef.current) {
      setLocalValues(values);
    }
  }, [values]);

  // Carrega defs + groups
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      customFieldsApi.list(entityType, ctrl.signal),
      customFieldsApi.listGroups(entityType, ctrl.signal),
    ])
      .then(([defs, grps]) => {
        setDefinitions(defs);
        setGroups(grps);
      })
      .catch((err) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setError(
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Erro ao carregar campos',
        );
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [entityType]);

  // Cleanup de timer
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  function handleFieldChange(name: string, next: unknown) {
    dirtyRef.current = true;
    setLocalValues((prev) => ({ ...prev, [name]: next }));

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persist();
    }, 800);
  }

  async function persist() {
    if (!dirtyRef.current) return;
    setSaving(true);
    try {
      await onSave({ ...localValues });
      dirtyRef.current = false;
    } catch (err) {
      toast.error('Falha ao salvar campos personalizados', {
        description:
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Erro desconhecido',
      });
    } finally {
      setSaving(false);
    }
  }

  // Agrupa definitions por group_id
  const groupedDefs = useMemo(() => {
    if (!definitions) return new Map<string, CustomFieldDefinition[]>();
    const map = new Map<string, CustomFieldDefinition[]>();
    for (const def of definitions) {
      const key = def.group_id ?? NO_GROUP_KEY;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(def);
    }
    // Ordena dentro de cada grupo por position
    for (const list of map.values()) {
      list.sort((a, b) => a.position - b.position);
    }
    return map;
  }, [definitions]);

  // Lista de seções a renderizar — primeiro os grupos cadastrados (na ordem
  // de position), depois "Principal" pra campos sem grupo.
  const sections = useMemo(() => {
    const out: Array<{ id: string; name: string; fields: CustomFieldDefinition[] }> = [];
    for (const g of groups) {
      const fields = groupedDefs.get(g.id) ?? [];
      if (fields.length > 0) out.push({ id: g.id, name: g.name, fields });
    }
    const noGroup = groupedDefs.get(NO_GROUP_KEY);
    if (noGroup && noGroup.length > 0) {
      // Se já temos grupos, "Principal" vira título; caso contrário sem título
      out.push({ id: NO_GROUP_KEY, name: 'Principal', fields: noGroup });
    }
    return out;
  }, [groupedDefs, groups]);

  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={cn('border-destructive/40', className)}>
        <CardContent className="py-3 text-xs text-destructive">{error}</CardContent>
      </Card>
    );
  }

  if (!definitions || definitions.length === 0) {
    // Org sem campos cadastrados — não polui o drawer com card vazio
    return null;
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {sections.map((section, idx) => (
        <Card key={section.id}>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs">{section.name}</CardTitle>
            {/* Spinner de save discreto no primeiro card pra não duplicar */}
            {idx === 0 && saving && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            {section.fields.map((field) => (
              <CustomFieldRenderer
                key={field.id}
                field={field}
                value={localValues[field.name]}
                onChange={(next) => handleFieldChange(field.name, next)}
                {...(entityId
                  ? { aiContext: { entityType, entityId } }
                  : {})}
              />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
