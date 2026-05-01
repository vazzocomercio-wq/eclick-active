import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getInitials } from '@/lib/format';
import { cn } from '@/lib/utils';

interface InitialsAvatarProps {
  name: string | null;
  src?: string | null;
  className?: string;
}

/** Avatar com fallback nas iniciais. Cor de fundo deriva do nome (estável por contato). */
export function InitialsAvatar({ name, src, className }: InitialsAvatarProps) {
  const bg = pickBg(name);
  return (
    <Avatar className={cn('h-9 w-9', className)}>
      {src ? <AvatarImage src={src} alt={name ?? 'avatar'} /> : null}
      <AvatarFallback className={cn('text-xs', bg)}>{getInitials(name)}</AvatarFallback>
    </Avatar>
  );
}

const PALETTE = [
  'bg-primary/20 text-primary',
  'bg-accent/20 text-accent',
  'bg-yellow-500/20 text-yellow-400',
  'bg-purple-500/20 text-purple-400',
  'bg-pink-500/20 text-pink-400',
  'bg-blue-500/20 text-blue-400',
  'bg-orange-500/20 text-orange-400',
];

function pickBg(name: string | null): string {
  if (!name) return PALETTE[0]!;
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length]!;
}
