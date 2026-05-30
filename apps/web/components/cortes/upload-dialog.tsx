'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileVideo, Loader2, UploadCloud } from 'lucide-react';
import { cortesApi } from '@/lib/api/studio-cortes';
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
    onOpenChange(false);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    try {
      await cortesApi.upload(file, title.trim() || undefined);
      toast.success('Vídeo enviado! Os cortes vão aparecer no board em alguns minutos.');
      onUploaded();
      setFile(null);
      setTitle('');
      onOpenChange(false);
    } catch (err) {
      toast.error('Falha no envio', {
        description: err instanceof ApiError ? err.message : String(err),
      });
    } finally {
      setUploading(false);
    }
  }

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
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors',
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
            disabled={uploading}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={uploading}>
            Cancelar
          </Button>
          <Button onClick={handleUpload} disabled={!file || uploading}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            <span className="ml-1.5">{uploading ? 'Enviando…' : 'Enviar e cortar'}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
