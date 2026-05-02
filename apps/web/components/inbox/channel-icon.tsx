import {
  Globe,
  Instagram,
  Mail,
  MessageCircle,
  MessageSquare,
  Music2,
  Send,
  ShoppingCart,
} from 'lucide-react';
import type { ChannelType } from '@eclick-active/shared';
import { cn } from '@/lib/utils';

const ICON_MAP: Record<ChannelType, typeof Mail> = {
  whatsapp: MessageCircle,
  whatsapp_free: MessageCircle,
  instagram: Instagram,
  messenger: MessageSquare,
  telegram: Send,
  email: Mail,
  webchat: Globe,
  tiktok: Music2,
  mercadolivre: ShoppingCart,
};

const COLOR_MAP: Record<ChannelType, string> = {
  whatsapp: 'text-green-500',
  whatsapp_free: 'text-emerald-400',
  instagram: 'text-pink-500',
  messenger: 'text-blue-500',
  telegram: 'text-sky-500',
  email: 'text-muted-foreground',
  webchat: 'text-primary',
  tiktok: 'text-foreground',
  mercadolivre: 'text-yellow-500',
};

interface ChannelIconProps {
  type: ChannelType;
  className?: string;
}

export function ChannelIcon({ type, className }: ChannelIconProps) {
  const Icon = ICON_MAP[type] ?? Mail;
  return <Icon className={cn('h-3.5 w-3.5', COLOR_MAP[type], className)} />;
}
