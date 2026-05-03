'use client';

import { useEffect, useState } from 'react';
import { Loader2, Sparkles, Wand2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { pagesApi } from '@/lib/api/pages';
import type { Page, PageType } from '@eclick-active/shared';
import { cn } from '@/lib/utils';

const PAGE_TYPE_OPTIONS: { value: PageType; label: string; description: string }[] = [
  {
    value: 'landing',
    label: 'Landing Page',
    description: 'Captura de leads, apresentação de produto/serviço',
  },
  {
    value: 'store',
    label: 'Loja',
    description: 'E-commerce com catálogo + carrinho + checkout',
  },
  {
    value: 'sales_page',
    label: 'Página de Vendas',
    description: 'Página longa de vendas com prova social, garantia, CTA forte',
  },
  {
    value: 'booking',
    label: 'Agendamento',
    description: 'Página pra agendar horário/consulta',
  },
  {
    value: 'link_in_bio',
    label: 'Link in Bio',
    description: 'Compacta tipo Linktree pra bio do Instagram',
  },
  {
    value: 'thank_you',
    label: 'Obrigado',
    description: 'Página de pós-conversão',
  },
];

/**
 * Pega o melhor texto possível de um erro pra mostrar no UI.
 * Lida com:
 *  - Erro contendo JSON do Anthropic embedado: "Falha ao gerar com IA: 400 {...}"
 *  - Erro NestJS estruturado { message, error, statusCode }
 *  - Error genérico com .message
 */
function humanizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Tenta achar JSON dentro do texto e extrair a mensagem do Anthropic
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        error?: { message?: string; type?: string };
        message?: string;
      };
      const inner = parsed.error?.message ?? parsed.message;
      if (typeof inner === 'string' && inner.length > 0) {
        const prefix = raw.slice(0, jsonMatch.index).trim();
        return prefix ? `${prefix.replace(/[:.\s]+$/, '')}: ${inner}` : inner;
      }
    } catch {
      /* não era JSON limpo */
    }
  }
  return raw.length > 0 ? raw : 'Erro ao gerar página. Tente novamente.';
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (page: Page) => void;
  initialDescription?: string;
  initialPageType?: PageType;
  initialUseCatalog?: boolean;
  initialIncludeForm?: boolean;
  initialIncludeWhatsApp?: boolean;
}

export function AiGenerateDialog({
  open,
  onOpenChange,
  onCreated,
  initialDescription,
  initialPageType,
  initialUseCatalog,
  initialIncludeForm,
  initialIncludeWhatsApp,
}: Props) {
  const [description, setDescription] = useState('');
  const [pageType, setPageType] = useState<PageType>('landing');
  const [useCatalog, setUseCatalog] = useState(false);
  const [includeForm, setIncludeForm] = useState(true);
  const [includeWhatsApp, setIncludeWhatsApp] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDescription(initialDescription ?? '');
      setPageType(initialPageType ?? 'landing');
      setUseCatalog(initialUseCatalog ?? false);
      setIncludeForm(initialIncludeForm ?? true);
      setIncludeWhatsApp(initialIncludeWhatsApp ?? true);
      setError(null);
      setGenerating(false);
    }
  }, [open, initialDescription, initialPageType, initialUseCatalog, initialIncludeForm, initialIncludeWhatsApp]);

  // Auto-set defaults baseado no tipo
  useEffect(() => {
    if (pageType === 'store') {
      setUseCatalog(true);
      setIncludeForm(false);
    } else if (pageType === 'thank_you') {
      setIncludeForm(false);
      setUseCatalog(false);
    }
  }, [pageType]);

  async function generate() {
    if (description.trim().length < 15) {
      setError('Descreva sua página com mais detalhes (mínimo 15 caracteres)');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const page = await pagesApi.generate({
        description: description.trim(),
        page_type: pageType,
        use_catalog_products: useCatalog,
        include_form: includeForm,
        include_whatsapp: includeWhatsApp,
      });
      onCreated(page);
    } catch (err) {
      setError(humanizeError(err));
      setGenerating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !generating && onOpenChange(o)}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 text-white">
              <Sparkles className="h-4 w-4" />
            </span>
            Criar página com IA
          </DialogTitle>
          <DialogDescription>
            Descreva o que você quer e o Claude vai criar a página completa — design, copy, blocos, SEO. Você pode editar tudo depois.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Tipo de página */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
              Tipo de página
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {PAGE_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPageType(opt.value)}
                  disabled={generating}
                  className={cn(
                    'flex flex-col items-start rounded-md border p-3 text-left transition-colors',
                    pageType === opt.value
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-background hover:border-primary/50',
                  )}
                >
                  <span className="text-sm font-semibold">{opt.label}</span>
                  <span className="mt-1 text-[10px] text-muted-foreground">
                    {opt.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Descrição */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
              Descreva sua página
            </Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: Quero uma loja para vender meus produtos de energia solar residencial em Salvador. Preciso de hero com vídeo, seção de benefícios, catálogo com preços, depoimentos, FAQ sobre instalação e formulário de orçamento. Cores modernas, tom profissional."
              rows={6}
              disabled={generating}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              autoFocus
            />
            <div className="mt-1 text-[11px] text-muted-foreground">
              Quanto mais detalhada a descrição, melhor o resultado. Inclua tom de voz, cores preferidas, blocos desejados.
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-2 rounded-md border border-border bg-background/50 p-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={useCatalog}
                onChange={(e) => setUseCatalog(e.target.checked)}
                disabled={generating}
                className="h-4 w-4"
              />
              <span>Usar produtos do meu catálogo</span>
              <span className="text-[10px] text-muted-foreground ml-auto">
                puxa dados reais do CRM
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={includeForm}
                onChange={(e) => setIncludeForm(e.target.checked)}
                disabled={generating}
                className="h-4 w-4"
              />
              <span>Incluir formulário de captura</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={includeWhatsApp}
                onChange={(e) => setIncludeWhatsApp(e.target.checked)}
                disabled={generating}
                className="h-4 w-4"
              />
              <span>Incluir botão WhatsApp flutuante</span>
            </label>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive break-words whitespace-pre-wrap">
              {error}
            </div>
          )}

          {generating && (
            <div className="flex items-center justify-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-4 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>
                Claude está criando sua página... pode levar 10-20 segundos.
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={generating}
          >
            Cancelar
          </Button>
          <Button onClick={generate} disabled={generating}>
            {generating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="mr-2 h-4 w-4" />
            )}
            {generating ? 'Gerando...' : 'Gerar página'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
