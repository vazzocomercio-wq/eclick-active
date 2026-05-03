'use client';

import { useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, Download, ExternalLink, Share2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Form } from '@eclick-active/shared';

interface Props {
  form: Form;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PublishDialog({ form, open, onOpenChange }: Props) {
  const url = useMemo(() => {
    if (typeof window === 'undefined') return `/f/${form.slug}`;
    return `${window.location.origin}/f/${form.slug}`;
  }, [form.slug]);

  const embedCode = useMemo(
    () =>
      `<iframe src="${url}" width="100%" height="700" frameborder="0" style="border:0;background:transparent" title="${form.name}"></iframe>`,
    [url, form.name],
  );

  const [copiedTab, setCopiedTab] = useState<'link' | 'embed' | null>(null);
  const [tab, setTab] = useState<'link' | 'embed' | 'qr'>('link');

  function copy(text: string, tab: 'link' | 'embed') {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedTab(tab);
        window.setTimeout(() => setCopiedTab(null), 1500);
      })
      .catch(() => {});
  }

  function downloadQr() {
    const svg = document.getElementById('form-qr-code');
    if (!svg) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svg);
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = dlUrl;
    a.download = `form-${form.slug}.svg`;
    a.click();
    URL.revokeObjectURL(dlUrl);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-primary" />
            Compartilhar formulário
          </DialogTitle>
          <DialogDescription>
            Escolha como divulgar &ldquo;{form.name}&rdquo;.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as 'link' | 'embed' | 'qr')}
          className="w-full"
        >
          <TabsList>
            <TabsTrigger value="link">Link</TabsTrigger>
            <TabsTrigger value="embed">Embed</TabsTrigger>
            <TabsTrigger value="qr">QR Code</TabsTrigger>
          </TabsList>

          <TabsContent value="link" className="mt-4 space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={url}
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
                onFocus={(e) => e.target.select()}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => copy(url, 'link')}
              >
                {copiedTab === 'link' ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copiar
                  </>
                )}
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Cole esse link no WhatsApp, Instagram bio, anúncios, etc. Cada
              clique vira um lead automático.
            </p>
          </TabsContent>

          <TabsContent value="embed" className="mt-4 space-y-3">
            <textarea
              readOnly
              value={embedCode}
              className="h-32 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
              onFocus={(e) => e.target.select()}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Cole esse código no seu site (HTML, WordPress, Wix, etc).
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copy(embedCode, 'embed')}
              >
                {copiedTab === 'embed' ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copiar
                  </>
                )}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="qr" className="mt-4 space-y-3">
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-md border border-border bg-white p-4">
                <QRCodeSVG
                  id="form-qr-code"
                  value={url}
                  size={200}
                  level="M"
                  includeMargin={false}
                />
              </div>
              <Button variant="outline" size="sm" onClick={downloadQr}>
                <Download className="h-3.5 w-3.5" />
                Baixar SVG
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Imprima em flyers, cartões de visita ou totens. Quem escanear
                cai direto na página do formulário.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
