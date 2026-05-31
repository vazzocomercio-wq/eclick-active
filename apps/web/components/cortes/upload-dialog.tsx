'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileVideo, Loader2, UploadCloud } from 'lucide-react';
import { uploadWithProgress } from '@/lib/api/studio-cortes';
import { ApiError } from '@/lib/api/client';
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
import { cn } from '@/lib/utils';

const ACCEPT = 'video/mp4,video/quicktime,video/webm,video/x-matroska';
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => void;
}

export function UploadDialog({ open, onOpenChange, onUploaded }: UploadDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sentBytes, setSentBytes] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(f: File | null) {
    if (!f) return;
    if (!f.type.startsWith('video/')) {
      toast.error('Envie um arquivo de vídeo.');
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error('Vídeo maior que 2GB.', {
        description: `Tamanho: ${(f.size / 1024 / 1024 / 1024).toFixed(2)}GB`,
      });
      return;
    }
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  }

  function close() {
    if (uploading) return;
    setFile(null);
    setTitle('');
    setProgress(0);
    setSentBytes(0);
    onOpenChange(false);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    setSentBytes(0);
    try {
      await uploadWithProgress(file, title.trim() || undefined, (pct, loaded) => {
        setProgress(pct);
        setSentBytes(loaded);
      });
      toast.success('Vídeo enviado! Os cortes vão aparecer no board em alguns minutos.');
      onUploaded();
      setFile(null);
      setTitle('');
      setProgress(0);
      setSentBytes(0);
      onOpenChange(false);
    } catch (err) {
      toast.error('Falha no envio', {
        description: err instanceof ApiError ? err.message : String(err),
      });
    } finally {
      setUploading(false);
    }
  }

  const totalMb = file ? file.size / 1024 / 1024 : 0;
  const sentMb = sentBytes / 1024 / 1024;
  // pct=100 mas ainda no try → backend subindo pro Drive + criando job.
  const processing = uploading && progress >= 100;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar vídeo-master</DialogTitle>
          <DialogDescription>
            O vídeo vai pro Drive e a IA gera os cortes verticais (9:16) com legenda por plataforma.
          </DialogDescription>
        </DialogHeader>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pick(e.dataTransfer.files?.[0] ?? null);
          }}
          onClick={() => {
            if (!uploading) inputRef.current?.click();
          }}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors',
            uploading ? 'cursor-default opacity-80' : 'cursor-pointer',
            dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
          )}
        >
          {file ? (
            <>
              <FileVideo className="h-8 w-8 text-primary" />
              <p className="text-sm font-medium text-foreground">{file.name}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </p>
            </>
          ) : (
            <>
              <UploadCloud className={cn('h-8 w-8', dragOver ? 'text-primary' : 'text-muted-foreground')} />
              <p className="text-sm font-medium">Arraste o vídeo ou clique pra escolher</p>
              <p className="text-xs text-muted-foreground">MP4, MOV, WEBM ou MKV — até 2GB</p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
            disabled={uploading}
          />
        </div>

        {uploading ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-primary">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
                {processing ? 'Processando no Drive…' : 'Enviando pro Drive…'}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {processing
                  ? `${totalMb.toFixed(1)} MB`
                  : `${sentMb.toFixed(1)} / ${totalMb.toFixed(1)} MB · ${progress}%`}
              </span>
            </div>
            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-[width] duration-200 ease-out',
                  processing && 'animate-pulse',
                )}
                style={{
                  width: processing ? '100%' : `${Math.max(progress, 3)}%`,
                  boxShadow: '0 0 12px rgba(0,229,255,0.55)',
                }}
              >
                {/* brilho deslizante */}
                <div className="absolute inset-0 -skew-x-12 animate-pulse bg-gradient-to-r from-transparent via-white/30 to-transparent" />
              </div>
            </div>
            {processing && (
              <p className="text-[11px] text-muted-foreground">
                Upload concluído — finalizando no Drive e criando o job…
              </p>
            )}
          </div>
        ) : (
          <div>
            <Label htmlFor="cortes-title" className="text-xs">
              Título do job (opcional)
            </Label>
            <Input
              id="cortes-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Live de lançamento — 28/05"
              className="mt-1"
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={uploading}>
            Cancelar
          </Button>
          <Button onClick={handleUpload} disabled={!file || uploading}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            <span className="ml-1.5 tabular-nums">
              {processing ? 'Processando…' : uploading ? `Enviando ${progress}%` : 'Enviar e cortar'}
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
