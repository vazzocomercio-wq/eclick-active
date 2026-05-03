'use client';

import {
  Globe,
  Instagram,
  Mail,
  MessageCircle,
  MessageSquare,
  Music2,
  Send,
  ShoppingCart,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import type { ChannelType } from '@eclick-active/shared';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const ICON_MAP: Record<string, LucideIcon> = {
  whatsapp: MessageCircle,
  whatsapp_free: MessageCircle,
  instagram: Instagram,
  messenger: MessageSquare,
  telegram: Send,
  email: Mail,
  webchat: Globe,
  tiktok: Music2,
  mercadolivre: ShoppingCart,
  sms: Smartphone,
};

const COLOR_MAP: Record<string, string> = {
  whatsapp: 'text-[#25D366]',
  whatsapp_free: 'text-[#25D366]',
  instagram: 'text-pink-500',
  messenger: 'text-[#0084FF]',
  telegram: 'text-[#0088CC]',
  email: 'text-blue-500',
  webchat: 'text-cyan-500',
  tiktok: 'text-foreground',
  mercadolivre: 'text-yellow-500',
  sms: 'text-muted-foreground',
};

const LABEL_MAP: Record<string, string> = {
  whatsapp: 'WhatsApp',
  whatsapp_free: 'WhatsApp QR',
  instagram: 'Instagram',
  messenger: 'Messenger',
  telegram: 'Telegram',
  email: 'Email',
  webchat: 'WebChat',
  tiktok: 'TikTok',
  mercadolivre: 'Mercado Livre',
  sms: 'SMS',
};

const SIZE_MAP = {
  sm: 'h-3.5 w-3.5',
  md: 'h-[18px] w-[18px]',
  lg: 'h-6 w-6',
} as const;

interface ChannelIconProps {
  type: ChannelType | (string & {});
  size?: 'sm' | 'md' | 'lg';
  /** Mostra tooltip on hover com nome do canal. */
  tooltip?: boolean;
  className?: string;
}

/**
 * Ícone do canal com cor canônica da marca:
 *   - WhatsApp / WhatsApp Free: verde #25D366
 *   - Instagram: rosa
 *   - Messenger: azul #0084FF
 *   - Telegram: azul #0088CC
 *   - Email: azul
 *   - WebChat: cyan
 *   - TikTok: foreground (preto/branco)
 *   - Mercado Livre: amarelo
 *   - SMS: muted (cinza)
 *
 * Reutilizável em: lista de conversas (sm), header do chat (md), detalhes
 * do contato (md), lista de canais em configurações (lg).
 */
export function ChannelIcon({ type, size = 'sm', tooltip = false, className }: ChannelIconProps) {
  const Icon = ICON_MAP[type] ?? Mail;
  const color = COLOR_MAP[type] ?? 'text-muted-foreground';
  const label = LABEL_MAP[type] ?? type;
  const sizeClass = SIZE_MAP[size];

  const icon = <Icon className={cn(sizeClass, color, className)} aria-label={label} />;

  if (!tooltip) return icon;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{icon}</span>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Helper exportado pra outros componentes mostrarem o nome humano do canal. */
export function channelLabel(type: ChannelType | (string & {})): string {
  return LABEL_MAP[type] ?? type;
}
