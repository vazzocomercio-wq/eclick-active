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
import type { Page } from '@eclick-active/shared';

interface Props {
  page: Page;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PublishDialog({ page, open, onOpenChange }: Props) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const url = useMemo(() => `${apiUrl}/p/${page.slug}`, [apiUrl, page.slug]);

  const embedCode = useMemo(
    () =>
      `<iframe src="${url}" width="100%" height="900" frameborder="0" style="border:0;" title="${page.name}"></iframe>`,
    [url, page.name],
  );

  const [copiedTab, setCopiedTab] = useState<'link' | 'embed' | null>(null);
  const [tab, setTab] = useState<'link' | 'embed' | 'qr'>('link');

  function copy(text: string, which: 'link' | 'embed') {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedTab(which);
        window.setTimeout(() => setCopiedTab(null), 1500);
      })
      .catch(() => {});
  }

  function downloadQr() {
    const svg = document.getElementById('page-qr-code');
    if (!svg) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svg);
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = dlUrl;
    a.download = `pagina-${page.slug}.svg`;
    a.click();
    URL.revokeObjectURL(dlUrl);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-primary" />
            Compartilhar página
          </DialogTitle>
          <DialogDescription>
            Página &ldquo;{page.name}&rdquo; — publicada e disponível em /p/{page.slug}.
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
              Compartilhe esse link em qualquer rede social, anúncio, bio do Instagram, WhatsApp, etc.
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
                <QRCodeSVG id="page-qr-code" value={url} size={220} level="M" />
              </div>
              <Button variant="outline" size="sm" onClick={downloadQr}>
                <Download className="h-3.5 w-3.5" />
                Baixar SVG
              </Button>
              <p className="text-center text-xs text-muted-foreground max-w-md">
                Imprima em flyers, cartões de visita ou totens. Quem escanear cai direto na página.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
