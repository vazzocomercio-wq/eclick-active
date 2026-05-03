'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Botão padronizado pra conectar canais. Mantém a identidade visual de
 * cada rede (cor + logo oficial) com tamanho/forma/efeito uniformes:
 * h-10, rounded-lg, sombra suave, hover com brilho e leve translate-y,
 * focus ring branca discreta.
 *
 * Variantes (brand):
 *  - whatsapp        → verde oficial (#25D366) com logo do WhatsApp
 *  - whatsapp-zapi   → mesma cor (mesma rede) com badge "Z-API"
 *  - instagram       → gradiente oficial (purple→pink→orange)
 *  - email           → azul (#2563EB)
 *  - tiktok          → preto com acentos pink+cyan no logo
 */

type BrandKey = 'whatsapp' | 'whatsapp-zapi' | 'instagram' | 'email' | 'tiktok';

interface BrandButtonProps {
  brand: BrandKey;
  label: string;
  /** Sub-label menor abaixo do title (ex: "Z-API", "QR Code"). */
  sublabel?: string;
  onClick?: () => void;
  loading?: boolean;
  disabled?: boolean;
}

const BRAND_BG: Record<BrandKey, string> = {
  whatsapp:
    'bg-[#25D366] hover:bg-[#1ebe5a] text-white shadow-[#25D366]/20',
  'whatsapp-zapi':
    'bg-[#128C7E] hover:bg-[#0e7167] text-white shadow-[#128C7E]/20',
  instagram:
    'bg-gradient-to-tr from-[#F58529] via-[#DD2A7B] to-[#8134AF] hover:opacity-90 text-white shadow-[#DD2A7B]/20',
  email:
    'bg-[#2563EB] hover:bg-[#1d4ed8] text-white shadow-[#2563EB]/20',
  tiktok:
    'bg-[#010101] hover:bg-[#1a1a1a] text-white shadow-black/30 ring-1 ring-white/5',
};

export function ChannelBrandButton({
  brand,
  label,
  sublabel,
  onClick,
  loading,
  disabled,
}: BrandButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        // Tamanho/forma uniformes pra todos
        'group relative inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold',
        'shadow-sm transition-all duration-150',
        'hover:shadow-md hover:-translate-y-px active:translate-y-0',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
        'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-sm',
        BRAND_BG[brand],
      )}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BrandIcon brand={brand} />}
      </span>
      <span className="flex flex-col items-start leading-tight">
        <span>{label}</span>
        {sublabel && (
          <span className="text-[10px] font-medium uppercase tracking-wider opacity-80">
            {sublabel}
          </span>
        )}
      </span>
    </button>
  );
}

function BrandIcon({ brand }: { brand: BrandKey }) {
  switch (brand) {
    case 'whatsapp':
    case 'whatsapp-zapi':
      return <WhatsAppIcon />;
    case 'instagram':
      return <InstagramIcon />;
    case 'email':
      return <EmailIcon />;
    case 'tiktok':
      return <TikTokIcon />;
  }
}

// Logo oficial do WhatsApp (path simplificado, fill currentColor).
function WhatsAppIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  );
}

// Glifo Instagram (square + círculo + ponto), branco em cima do gradiente.
function InstagramIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <rect width="20" height="20" x="2" y="2" rx="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

// Logo TikTok com toques pink/cyan (duotone offset).
function TikTokIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      aria-hidden="true"
    >
      {/* Sombra cyan deslocada à esquerda */}
      <path
        d="M19.09 6.19a4.83 4.83 0 0 1-3.77-4.25V1.5h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V8.9a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.12 19.6a6.34 6.34 0 0 0 10.86-4.43V8.33a8.16 8.16 0 0 0 4.77 1.52V6.33a4.85 4.85 0 0 1-1.66-.14z"
        fill="#25F4EE"
      />
      {/* Sombra pink deslocada à direita */}
      <path
        d="M20.09 7.19a4.83 4.83 0 0 1-3.77-4.25V2.5h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.9a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 6.12 20.6a6.34 6.34 0 0 0 10.86-4.43V9.33a8.16 8.16 0 0 0 4.77 1.52V7.33a4.85 4.85 0 0 1-1.66-.14z"
        fill="#FE2C55"
      />
      {/* Logo principal branco por cima */}
      <path
        d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.62 20.1a6.34 6.34 0 0 0 10.86-4.43V8.83a8.16 8.16 0 0 0 4.77 1.52V6.83a4.85 4.85 0 0 1-1.66-.14z"
        fill="#FFFFFF"
      />
    </svg>
  );
}
