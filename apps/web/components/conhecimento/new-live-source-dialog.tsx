'use client';

import { useState } from 'react';
import { Globe, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { knowledgeApi } from '@/lib/api/knowledge';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const TTL_OPTIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hora' },
  { value: 360, label: '6 horas' },
  { value: 1440, label: '24 horas' },
];

interface NewLiveSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function NewLiveSourceDialog({ open, onOpenChange, onCreated }: NewLiveSourceDialogProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [sourceType, setSourceType] = useState<'webpage' | 'api_endpoint' | 'rss_feed'>('webpage');
  const [ttl, setTtl] = useState(60);
  const [saving, setSaving] = useState(false);

  function reset() {
    setName('');
    setUrl('');
    setDescription('');
    setSourceType('webpage');
    setTtl(60);
  }

  async function handleSave() {
    if (!name.trim() || !url.trim()) {
      toast.error('Nome e URL são obrigatórios');
      return;
    }
    setSaving(true);
    try {
      await knowledgeApi.createLiveSource({
        name: name.trim(),
        url: url.trim(),
        description: description.trim() || undefined,
        source_type: sourceType,
        cache_ttl_minutes: ttl,
        is_active: true,
      });
      toast.success('Fonte live criada', {
        description: 'A IA já pode consultar essa fonte quando precisar de dados atualizados.',
      });
      reset();
      onCreated();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro';
      toast.error('Falha ao criar fonte', { description: msg });
    } finally {
      setSaving(false);
    }
  }

  function handleClose(o: boolean) {
    if (!o && !saving) reset();
    onOpenChange(o);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            Nova fonte live
          </DialogTitle>
          <DialogDescription>
            Cadastre uma URL que a IA consulta em tempo real quando precisa de informação atualizada (estoque, preços do dia, status).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Nome</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Loja Mercado Livre, Catálogo online"
              maxLength={200}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>URL</Label>
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Descrição</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Quando a IA deve consultar esta fonte? Ex: 'Produtos à venda com preços e estoque atualizados'"
              rows={3}
            />
            <span className="text-[11px] text-muted-foreground">
              A IA usa a descrição pra decidir QUANDO consultar — quanto mais clara, melhor o roteamento.
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Tipo</Label>
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value as typeof sourceType)}
                className={cn(
                  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring',
                )}
              >
                <option value="webpage">Página web</option>
                <option value="api_endpoint">Endpoint API</option>
                <option value="rss_feed">Feed RSS</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Cache TTL</Label>
              <select
                value={ttl}
                onChange={(e) => setTtl(Number(e.target.value))}
                className={cn(
                  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring',
                )}
              >
                {TTL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-muted-foreground">
                A cada {ttl} min, a IA busca dados atualizados desta fonte.
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Criar fonte
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
