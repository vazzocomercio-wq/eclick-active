'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Radar, RefreshCw, Loader2, Plus, Trash2, Play, TrendingUp,
  Megaphone, AtSign, Music, Sparkles, CheckCircle2, CircleDashed, Eye, DownloadCloud,
  Wand2, X, Brain, Hash, Users, FlaskConical, Globe2, Clapperboard, ExternalLink, AlertTriangle, Scissors,
  Youtube, ImageIcon, Send,
} from 'lucide-react';
import {
  socialApi,
  trendThumbUrl,
  type TrendsOverview,
  type TrendMonitor,
  type TrendSignal,
  type TrendItem,
  type TrendBrief,
  type TrendBriefProduct,
  type TrendNetwork,
  type TrendProfile,
  type TrendPattern,
  type ProfileNetwork,
  type HeyGenJob,
  type HeyGenOptions,
} from '@/lib/api/social';
import { cortesApi } from '@/lib/api/studio-cortes';
import {
  ytLongformApi,
  type YouTubePublication,
  type YTChannel,
  type YTPrivacy,
} from '@/lib/api/youtube-longform';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NETWORKS: { value: TrendNetwork; label: string }[] = [
  { value: 'youtube', label: 'YouTube' },
  { value: 'google_trends', label: 'Google Trends' },
  { value: 'meta_ads', label: 'Meta Ad Library' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
];
const NET_LABEL: Record<string, string> = Object.fromEntries(
  NETWORKS.map((n) => [n.value, n.label]),
);
const FORMAT_LABEL: Record<string, string> = {
  reel: 'Reel', post: 'Post', carousel: 'Carrossel', story: 'Story', video: 'Vídeo',
  youtube: 'Vídeo YouTube', youtube_short: 'YouTube Short',
};
/** Formato da pauta → formato que o Social AI Studio entende. */
const STUDIO_FORMAT: Record<string, string> = {
  youtube: 'video', youtube_short: 'reel',
};

/** Monta a URL do Social AI Studio pré-preenchida a partir de uma pauta (1-clique). */
function briefHref(b: TrendBrief, prod?: TrendBriefProduct): string {
  const params = new URLSearchParams({ format: STUDIO_FORMAT[b.format] ?? b.format, theme: b.title });
  if (b.hook) params.set('hook', b.hook);
  if (prod?.product_id) params.set('product_id', prod.product_id);
  if (prod?.name) params.set('product_search', prod.name);
  if (b.target_seconds) params.set('duration', String(b.target_seconds));
  return `/social/criar?${params.toString()}`;
}
/** "~5 min" / "~45s" a partir da duração-alvo em segundos. */
function durationLabel(seconds: number): string {
  return seconds >= 90 ? `~${Math.round(seconds / 60)} min` : `~${seconds}s`;
}
function NetIcon({ source, className }: { source: TrendNetwork; className?: string }) {
  switch (source) {
    case 'youtube': return <Play className={className} />;
    case 'google_trends': return <TrendingUp className={className} />;
    case 'meta_ads': return <Megaphone className={className} />;
    case 'instagram': return <AtSign className={className} />;
    case 'tiktok': return <Music className={className} />;
    default: return <Radar className={className} />;
  }
}
const nf = (n: number) => n.toLocaleString('pt-BR');

export default function TendenciasPage() {
  const [overview, setOverview] = useState<TrendsOverview | null>(null);
  const [monitors, setMonitors] = useState<TrendMonitor[]>([]);
  const [signals, setSignals] = useState<TrendSignal[]>([]);
  const [items, setItems] = useState<TrendItem[]>([]);
  const [briefs, setBriefs] = useState<TrendBrief[]>([]);
  const [profiles, setProfiles] = useState<TrendProfile[]>([]);
  const [patterns, setPatterns] = useState<TrendPattern[]>([]);
  const [loading, setLoading] = useState(true);

  // escopo de categoria ('' = todas)
  const [activeCategory, setActiveCategory] = useState('');
  const [clearing, setClearing] = useState(false);

  // curadoria de perfis (Pilar 1)
  const [pRaw, setPRaw] = useState('');
  const [pNetwork, setPNetwork] = useState<ProfileNetwork>('instagram');
  const [pCategory, setPCategory] = useState('');
  const [pCountry, setPCountry] = useState('');
  const [importing, setImporting] = useState(false);
  const [mining, setMining] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // add-monitor form
  const [showForm, setShowForm] = useState(false);
  const [fNetwork, setFNetwork] = useState<TrendNetwork>('youtube');
  const [fCategory, setFCategory] = useState('');
  const [fKeywords, setFKeywords] = useState('');
  const [saving, setSaving] = useState(false);

  // coleta
  const [collecting, setCollecting] = useState(false);
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [collectMsg, setCollectMsg] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  // duração-alvo do roteiro de vídeo longo de YouTube (0 = Auto, deixa a IA decidir)
  const [targetMin, setTargetMin] = useState(0);

  // HeyGen — texto-para-vídeo com avatar
  const [heygenConfigured, setHeygenConfigured] = useState(false);
  const [heygenJobs, setHeygenJobs] = useState<HeyGenJob[]>([]);
  const [hgBrief, setHgBrief] = useState<TrendBrief | null>(null); // pauta do modal aberto
  const [hgOptions, setHgOptions] = useState<HeyGenOptions | null>(null);
  const [hgLoadingOpts, setHgLoadingOpts] = useState(false);
  const [hgAvatar, setHgAvatar] = useState('');
  const [hgVoice, setHgVoice] = useState('');
  const [hgTemplate, setHgTemplate] = useState(''); // '' = avatar+voz avulsos
  const [hgBrandScene, setHgBrandScene] = useState(false); // cenário e-Click (recorta avatar + fundo da marca)
  const [hgAutoCortes, setHgAutoCortes] = useState(false); // automação completa → cortes
  const [hgCreating, setHgCreating] = useState(false);
  const [cortesBusyId, setCortesBusyId] = useState<string | null>(null); // job HeyGen gerando corte

  // Publicação de vídeo longo no YouTube
  const [ytBusyJobId, setYtBusyJobId] = useState<string | null>(null); // botão do card gerando rascunho
  const [ytPub, setYtPub] = useState<YouTubePublication | null>(null); // publicação aberta no modal
  const [ytChannels, setYtChannels] = useState<YTChannel[]>([]);
  const [ytBusy, setYtBusy] = useState<'save' | 'thumb' | 'publish' | null>(null);
  const [ytForm, setYtForm] = useState<{
    title: string;
    description: string;
    tagsText: string;
    privacy: YTPrivacy;
    channel: string;
  }>({ title: '', description: '', tagsText: '', privacy: 'public', channel: '' });

  const load = async () => {
    try {
      const [o, m, s, it, b, pf, pt, hgStatus, hgJobs] = await Promise.all([
        socialApi.trends.overview(),
        socialApi.trends.monitors(),
        socialApi.trends.signals(),
        socialApi.trends.items({ limit: 60 }),
        socialApi.trends.briefs(),
        socialApi.trends.profiles(),
        socialApi.trends.patterns(),
        socialApi.heygen.status().catch(() => ({ configured: false })),
        socialApi.heygen.jobs().catch(() => [] as HeyGenJob[]),
      ]);
      setOverview(o);
      setMonitors(m);
      setSignals(s);
      setItems(it);
      setBriefs(b);
      setProfiles(pf);
      setPatterns(pt);
      setHeygenConfigured(hgStatus.configured);
      setHeygenJobs(hgJobs);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Polling dos jobs HeyGen em andamento (a leitura do job atualiza o status no
  // servidor). Recria o intervalo só quando o conjunto de jobs abertos muda.
  const openHeygenIds = heygenJobs
    .filter((j) => j.status === 'pending' || j.status === 'processing')
    .map((j) => j.id)
    .join(',');
  useEffect(() => {
    if (!openHeygenIds) return;
    const ids = openHeygenIds.split(',');
    const tick = async () => {
      const updated = await Promise.all(
        ids.map((id) => socialApi.heygen.job(id).catch(() => null)),
      );
      setHeygenJobs((prev) =>
        prev.map((j) => updated.find((u) => u && u.id === j.id) ?? j),
      );
    };
    const t = setInterval(() => void tick(), 8000);
    return () => clearInterval(t);
  }, [openHeygenIds]);

  const addMonitor = async () => {
    if (!fCategory.trim()) return;
    setSaving(true);
    try {
      await socialApi.trends.createMonitor({
        network: fNetwork,
        category: fCategory.trim(),
        keywords: fKeywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      });
      setFCategory('');
      setFKeywords('');
      setShowForm(false);
      await load();
    } catch {
      /* silent */
    } finally {
      setSaving(false);
    }
  };

  const collectAll = async () => {
    setCollecting(true);
    setCollectMsg(null);
    try {
      const r = await socialApi.trends.collect();
      setCollectMsg(
        r.monitors === 0
          ? 'Nenhum monitor de YouTube/Google Trends/TikTok ativo pra coletar.'
          : `Coleta concluída: ${r.items} itens de ${r.monitors} monitor(es).`,
      );
      await load();
    } catch {
      setCollectMsg('Falha na coleta. Tente novamente.');
    } finally {
      setCollecting(false);
    }
  };

  const collectMonitor = async (id: string) => {
    setCollectingId(id);
    setCollectMsg(null);
    try {
      const r = await socialApi.trends.collectMonitor(id);
      setCollectMsg(
        r.items > 0
          ? `Coleta deste monitor concluída: ${r.items} item(ns).`
          : 'Coleta concluída, mas nenhum item novo veio (revise as palavras-chave do monitor).',
      );
      await load();
    } catch (e) {
      setCollectMsg(`Falha ao coletar este monitor: ${(e as Error)?.message ?? 'erro desconhecido'}`);
    } finally {
      setCollectingId(null);
    }
  };

  const generateBriefs = async () => {
    setGenerating(true);
    setCollectMsg(null);
    try {
      const r = await socialApi.trends.generate(
        activeCategory || undefined,
        targetMin || undefined,
      );
      const scope = activeCategory ? ` em "${activeCategory}"` : '';
      setCollectMsg(
        r.briefs > 0
          ? `IA gerou ${r.briefs} pauta(s) e ${r.signals} sinal(is)${scope}.`
          : 'Sem dados suficientes pra gerar pautas — colete/minere tendências primeiro.',
      );
      await load();
    } catch {
      setCollectMsg('Falha ao gerar pautas. Tente novamente.');
    } finally {
      setGenerating(false);
    }
  };

  const dismissBrief = async (id: string) => {
    setBriefs((prev) => prev.filter((b) => b.id !== id));
    try {
      await socialApi.trends.dismissBrief(id);
    } catch {
      /* silent */
    }
  };

  // Abre o modal HeyGen pra uma pauta e carrega avatares/vozes/templates.
  const openHeygen = async (b: TrendBrief) => {
    setHgBrief(b);
    setHgOptions(null);
    setHgAvatar('');
    setHgVoice('');
    setHgTemplate('');
    setHgBrandScene(false);
    setHgAutoCortes(false);
    setHgLoadingOpts(true);
    try {
      const o = await socialApi.heygen.options();
      setHgOptions(o);
      // se houver templates, já seleciona o primeiro (ambiente fixo)
      if (o.templates[0]) setHgTemplate(o.templates[0].template_id);
      if (o.avatars[0]) setHgAvatar(o.avatars[0].avatar_id);
      // default: prioriza uma voz em português
      const pt = o.voices.find((v) => (v.language ?? '').toLowerCase().includes('port'))
        ?? o.voices[0];
      if (pt) setHgVoice(pt.voice_id);
    } catch {
      setHgOptions({ configured: false, avatars: [], voices: [], templates: [] });
    } finally {
      setHgLoadingOpts(false);
    }
  };

  // Dispara a geração REAL do vídeo (custo $) — só por clique explícito aqui.
  const createHeygen = async () => {
    // tanto template quanto avulso precisam de voz (o HeyGen exige voice_id na
    // variável de fala do template); avatar/fundo do template vêm dele.
    if (!hgBrief || !hgVoice || (!hgTemplate && !hgAvatar)) return;
    setHgCreating(true);
    setCollectMsg(null);
    try {
      const selAvatar = hgOptions?.avatars.find((a) => a.avatar_id === hgAvatar);
      const job = await socialApi.heygen.createJob({
        brief_id: hgBrief.id,
        voice_id: hgVoice,
        ...(hgTemplate
          ? { template_id: hgTemplate }
          : {
              avatar_id: hgAvatar,
              is_talking_photo: !!selAvatar?.is_talking_photo,
              brand_scene: hgBrandScene,
            }),
        auto_cortes: hgAutoCortes,
      });
      setHeygenJobs((prev) => [job, ...prev]);
      setHgBrief(null);
      setCollectMsg(
        hgAutoCortes
          ? 'Vídeo enviado pro HeyGen — ao concluir, os cortes serão gerados automaticamente (quando a automação estiver liberada).'
          : 'Vídeo enviado pro HeyGen — acompanhe o progresso na seção “Vídeos HeyGen”.',
      );
    } catch (e) {
      setCollectMsg(`Falha ao gerar vídeo no HeyGen: ${(e as Error)?.message ?? 'erro'}`);
    } finally {
      setHgCreating(false);
    }
  };

  // Botão manual: gera cortes a partir de um vídeo HeyGen já concluído (custo $).
  const gerarCortesDoHeygen = async (job: HeyGenJob) => {
    if (job.status !== 'completed' || cortesBusyId) return;
    setCortesBusyId(job.id);
    setCollectMsg(null);
    try {
      await cortesApi.createFromHeygen(job.id);
      setHeygenJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, cortes_job_id: 'pending' } : j)),
      );
      setCollectMsg('Cortes em geração — acompanhe no Studio de Cortes (Social › Cortes).');
    } catch (e) {
      setCollectMsg(`Falha ao gerar cortes: ${(e as Error)?.message ?? 'erro'}`);
    } finally {
      setCortesBusyId(null);
    }
  };

  // Abre o fluxo de publicação no YouTube: gera (ou recupera) o rascunho com
  // metadados+miniatura por IA e os canais conectados. NÃO publica nada aqui.
  const abrirPublicarYoutube = async (job: HeyGenJob) => {
    if (job.status !== 'completed' || ytBusyJobId) return;
    setYtBusyJobId(job.id);
    setCollectMsg(null);
    try {
      const [pub, chs] = await Promise.all([
        ytLongformApi.draft({ heygen_job_id: job.id }),
        ytLongformApi.channels().catch(() => [] as YTChannel[]),
      ]);
      setYtChannels(chs);
      abrirModalYoutube(pub, chs);
    } catch (e) {
      setCollectMsg(`Falha ao preparar publicação no YouTube: ${(e as Error)?.message ?? 'erro'}`);
    } finally {
      setYtBusyJobId(null);
    }
  };

  const abrirModalYoutube = (pub: YouTubePublication, chs: YTChannel[]) => {
    setYtPub(pub);
    setYtForm({
      title: pub.title,
      description: pub.description,
      tagsText: (pub.tags ?? []).join(', '),
      privacy: pub.privacy,
      channel: pub.channel_cred_id ?? chs[0]?.id ?? '',
    });
  };

  const ytFormPatch = () => ({
    title: ytForm.title,
    description: ytForm.description,
    tags: ytForm.tagsText.split(',').map((t) => t.trim()).filter(Boolean),
    privacy: ytForm.privacy,
    channel_cred_id: ytForm.channel || null,
  });

  const salvarRascunhoYoutube = async () => {
    if (!ytPub || ytBusy) return;
    setYtBusy('save');
    try {
      const updated = await ytLongformApi.update(ytPub.id, ytFormPatch());
      setYtPub(updated);
      setCollectMsg('Rascunho salvo.');
    } catch (e) {
      setCollectMsg(`Falha ao salvar: ${(e as Error)?.message ?? 'erro'}`);
    } finally {
      setYtBusy(null);
    }
  };

  const regerarCapaYoutube = async () => {
    if (!ytPub || ytBusy) return;
    setYtBusy('thumb');
    try {
      const updated = await ytLongformApi.regenerateThumbnail(ytPub.id);
      setYtPub(updated);
    } catch (e) {
      setCollectMsg(`Falha ao regerar a capa: ${(e as Error)?.message ?? 'erro'}`);
    } finally {
      setYtBusy(null);
    }
  };

  const publicarNoYoutube = async () => {
    if (!ytPub || ytBusy) return;
    if (!ytForm.channel) {
      setCollectMsg('Escolha o canal do YouTube antes de publicar.');
      return;
    }
    const aviso =
      ytForm.privacy === 'public'
        ? 'Publicar este vídeo no YouTube como PÚBLICO (vai ao ar imediatamente)?'
        : `Publicar este vídeo no YouTube (${ytForm.privacy})?`;
    if (!window.confirm(aviso)) return;
    setYtBusy('publish');
    setCollectMsg(null);
    try {
      // Salva as edições e em seguida publica de fato.
      await ytLongformApi.update(ytPub.id, ytFormPatch());
      const result = await ytLongformApi.publish(ytPub.id, ytForm.channel);
      setYtPub(result);
      if (result.status === 'published') {
        setCollectMsg(`Publicado no YouTube! ${result.youtube_url ?? ''}`);
      } else {
        setCollectMsg(`A publicação não concluiu: ${result.error ?? 'erro'}`);
      }
    } catch (e) {
      setCollectMsg(`Falha ao publicar: ${(e as Error)?.message ?? 'erro'}`);
    } finally {
      setYtBusy(null);
    }
  };

  const importProfiles = async () => {
    if (!pRaw.trim()) return;
    setImporting(true);
    setCollectMsg(null);
    try {
      const r = await socialApi.trends.importProfiles({
        raw: pRaw,
        network: pNetwork,
        category: pCategory.trim() || undefined,
        country: pCountry.trim() || undefined,
      });
      setCollectMsg(
        `Perfis importados: ${r.imported}${r.skipped ? ` · ${r.skipped} ignorados (formato inválido)` : ''}.`,
      );
      setPRaw('');
      await load();
    } catch {
      setCollectMsg('Falha ao importar perfis.');
    } finally {
      setImporting(false);
    }
  };

  const mineProfiles = async () => {
    setMining(true);
    setCollectMsg(null);
    try {
      const r = await socialApi.trends.mineProfiles();
      setCollectMsg(
        r.profiles === 0
          ? 'Nenhum perfil ativo de IG/TikTok pra minerar. Adicione perfis primeiro.'
          : `Mineração concluída: ${r.items} posts de ${r.profiles} perfil(is).`,
      );
      await load();
    } catch {
      setCollectMsg('Falha na mineração. Verifique o APIFY_TOKEN.');
    } finally {
      setMining(false);
    }
  };

  const analyzePatterns = async () => {
    setAnalyzing(true);
    setCollectMsg(null);
    try {
      const r = await socialApi.trends.analyze(
        activeCategory ? { category: activeCategory } : {},
      );
      const scope = activeCategory ? ` em "${activeCategory}"` : '';
      setCollectMsg(
        r.patterns > 0
          ? `Engenharia reversa: ${r.patterns} padrão(ões) vencedor(es)${scope}. Já alimentam o roteirista.`
          : 'Sem itens suficientes pra analisar — minere perfis primeiro.',
      );
      await load();
    } catch {
      setCollectMsg('Falha ao analisar padrões.');
    } finally {
      setAnalyzing(false);
    }
  };

  const clearItemsAction = async () => {
    const scoped = activeCategory.trim();
    const msg = scoped
      ? `Limpar todos os itens coletados da categoria "${scoped}"?`
      : 'Sem categoria selecionada — limpar os itens com mais de 30 dias?';
    if (!confirm(msg)) return;
    setClearing(true);
    setCollectMsg(null);
    try {
      const r = await socialApi.trends.clearItems(
        scoped ? { category: scoped } : { older_than_days: 30 },
      );
      setCollectMsg(`${r.deleted} item(ns) removido(s)${scoped ? ` de "${scoped}"` : ' (>30 dias)'}.`);
      await load();
    } catch {
      setCollectMsg('Falha ao limpar itens.');
    } finally {
      setClearing(false);
    }
  };

  const removeProfile = async (id: string) => {
    setProfiles((prev) => prev.filter((p) => p.id !== id));
    try {
      await socialApi.trends.deleteProfile(id);
    } catch {
      /* silent */
    }
  };

  const removeMonitor = async (id: string) => {
    const mon = monitors.find((m) => m.id === id);
    const cat = mon?.category;
    const shared = cat ? monitors.filter((m) => m.category === cat).length > 1 : false;
    const msg = cat && !shared
      ? `Remover a categoria "${cat}"? Isso apaga o monitor e os itens/sinais/pautas dela.`
      : 'Remover este monitor de tendência?';
    if (!confirm(msg)) return;
    try {
      await socialApi.trends.deleteMonitor(id);
      setMonitors((prev) => prev.filter((m) => m.id !== id));
      // se a categoria removida estava selecionada, volta pra "Todas"
      if (cat && !shared && activeCategory === cat) setActiveCategory('');
      void load();
    } catch {
      /* silent */
    }
  };

  // Categorias do dropdown = SÓ as categorias monitoradas (os monitores).
  // Excluir um monitor remove a categoria daqui na hora; itens/perfis órfãos
  // não poluem mais o seletor.
  const categories = useMemo(() => {
    const set = new Set<string>();
    monitors.forEach((m) => m.category && set.add(m.category));
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [monitors]);

  // O seletor de duração só faz sentido quando a categoria em foco é de YouTube
  // (a pauta vira roteiro de vídeo). Sem categoria, basta haver 1 monitor de YT.
  const youtubeRelevant = useMemo(() => {
    const yt = monitors.filter((m) => m.network === 'youtube' && m.is_active);
    if (!yt.length) return false;
    return activeCategory ? yt.some((m) => m.category === activeCategory) : true;
  }, [monitors, activeCategory]);

  // escopo aplicado às seções de dados
  const fItems = activeCategory ? items.filter((i) => i.category === activeCategory) : items;
  const fSignals = activeCategory ? signals.filter((s) => s.category === activeCategory) : signals;
  const fPatterns = activeCategory
    ? patterns.filter((p) => p.category === activeCategory)
    : patterns;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/social"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <Radar className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">Radar de Conteúdo</h1>
            <p className="text-xs text-muted-foreground">
              O que está bombando na sua categoria — e qual conteúdo criar a partir disso
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            <span className="ml-1">Atualizar</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => void mineProfiles()} disabled={mining || loading} title="Minerar os posts recentes dos perfis de referência">
            {mining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
            <span className="ml-1">{mining ? 'Minerando…' : 'Minerar perfis'}</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => void analyzePatterns()} disabled={analyzing || loading} title={activeCategory ? `Engenharia reversa só de "${activeCategory}"` : 'Engenharia reversa dos posts vencedores (todas as categorias)'}>
            {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
            <span className="ml-1">{analyzing ? 'Analisando…' : activeCategory ? `Analisar · ${activeCategory}` : 'Analisar'}</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => void collectAll()} disabled={collecting || loading}>
            {collecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
            <span className="ml-1">{collecting ? 'Coletando…' : 'Coletar'}</span>
          </Button>
          {youtubeRelevant && (
            <div className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1" title="Duração do roteiro de vídeo longo de YouTube (Shorts ficam sempre em 30-60s)">
              <Play className="h-3 w-3 text-muted-foreground" />
              <select
                value={targetMin}
                onChange={(e) => setTargetMin(Number(e.target.value))}
                className="bg-transparent text-xs outline-none"
                disabled={generating}
              >
                <option value={0}>Duração: auto</option>
                <option value={3}>~3 min</option>
                <option value={5}>~5 min</option>
                <option value={8}>~8 min</option>
                <option value={12}>~12 min</option>
              </select>
            </div>
          )}
          <Button size="sm" onClick={() => void generateBriefs()} disabled={generating || loading} title={activeCategory ? `Gera pautas só de "${activeCategory}" (mude no seletor Categoria abaixo)` : 'Gera pautas de TODAS as categorias (selecione uma categoria abaixo p/ focar)'}>
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
            <span className="ml-1">{generating ? 'Gerando…' : activeCategory ? `Gerar pautas · ${activeCategory}` : 'Gerar pautas IA'}</span>
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {collectMsg && (
          <div className="mb-4 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground/80">
            {collectMsg}
          </div>
        )}
        {/* ── FILTRO DE CATEGORIA (escopo) ── */}
        {!loading && categories.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <span className="text-[11px] font-medium text-muted-foreground">Categoria:</span>
            <select
              value={activeCategory}
              onChange={(e) => setActiveCategory(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            >
              <option value="">Todas</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {activeCategory && (
              <span className="text-[11px] text-muted-foreground">
                Sinais, itens, padrões, <b>Analisar</b> e <b>Gerar pautas</b> agora focam em “{activeCategory}”.
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-destructive hover:text-destructive"
              onClick={() => void clearItemsAction()}
              disabled={clearing}
              title={activeCategory ? `Limpar itens de "${activeCategory}"` : 'Limpar itens com mais de 30 dias'}
            >
              {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              <span className="ml-1">{activeCategory ? 'Limpar categoria' : 'Limpar antigos'}</span>
            </Button>
          </div>
        )}
        {loading ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Carregando o radar…</span>
          </div>
        ) : (
          <>
            {/* ── FONTES DE TENDÊNCIA ── */}
            <section className="mb-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-primary" />Fontes de tendência
                <span className="text-xs font-normal text-muted-foreground">
                  · {overview?.items ?? 0} itens coletados · {overview?.signals ?? 0} sinais
                </span>
              </h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(overview?.by_source ?? []).map((src) => (
                  <div
                    key={src.source}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border p-3',
                      src.status === 'live'
                        ? 'border-emerald-500/40 bg-emerald-500/5'
                        : 'border-border bg-card',
                    )}
                  >
                    <div className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                      src.status === 'live' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-muted text-muted-foreground',
                    )}>
                      <NetIcon source={src.source} className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-medium">{src.label}</span>
                        {src.status === 'live' ? (
                          <span className="flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-500">
                            <CheckCircle2 className="h-2.5 w-2.5" />{nf(src.items)} itens
                          </span>
                        ) : (
                          <span className="flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                            <CircleDashed className="h-2.5 w-2.5" />{src.phase}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{src.note}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ── PERFIS DE REFERÊNCIA (Inteligência Global) ── */}
            <section className="mb-6">
              <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
                <Globe2 className="h-4 w-4 text-primary" />Perfis de referência
                <span className="text-xs font-normal text-muted-foreground">
                  · {overview?.active_profiles ?? profiles.length} ativos · modele quem já performa
                </span>
              </h2>
              <p className="mb-3 text-[11px] text-muted-foreground">
                Cole 20-100 perfis do seu nicho (do mundo todo). O radar minera os posts recentes deles e a
                engenharia reversa extrai o que faz performar — pra você ser pioneiro no Brasil.
              </p>

              <div className="mb-3 flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <textarea
                  value={pRaw}
                  onChange={(e) => setPRaw(e.target.value)}
                  rows={3}
                  placeholder={'Cole URLs ou @handles (1 por linha)\nhttps://www.instagram.com/perfil/\nhttps://www.tiktok.com/@perfil\n@outro_perfil'}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-muted-foreground">Rede (p/ @handle sem URL)</label>
                    <select
                      value={pNetwork}
                      onChange={(e) => setPNetwork(e.target.value as ProfileNetwork)}
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    >
                      <option value="instagram">Instagram</option>
                      <option value="tiktok">TikTok</option>
                      <option value="youtube">YouTube</option>
                      <option value="x">X (Twitter)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-muted-foreground">Nicho</label>
                    <input
                      value={pCategory}
                      onChange={(e) => setPCategory(e.target.value)}
                      placeholder="ex: iluminação"
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-muted-foreground">País (opcional)</label>
                    <input
                      value={pCountry}
                      onChange={(e) => setPCountry(e.target.value)}
                      placeholder="ex: EUA, Japão"
                      className="w-28 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    />
                  </div>
                  <Button size="sm" onClick={() => void importProfiles()} disabled={importing || !pRaw.trim()}>
                    {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    <span className="ml-1">Importar</span>
                  </Button>
                </div>
              </div>

              {profiles.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                  Nenhum perfil de referência ainda. Cole os perfis que te inspiram — eles são a base do método.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {profiles.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-2 pr-1 text-xs">
                      <NetIcon source={(p.network === 'x' || p.network === 'youtube') ? 'youtube' : p.network as TrendNetwork} className="h-3 w-3 text-muted-foreground" />
                      <a href={p.url ?? '#'} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                        @{p.handle}
                      </a>
                      {p.country && <span className="text-[10px] text-muted-foreground">· {p.country}</span>}
                      {!p.is_active && <span className="text-[10px] text-amber-500">pausado</span>}
                      <button onClick={() => void removeProfile(p.id)} className="text-muted-foreground hover:text-destructive" title="Remover">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── CATEGORIAS MONITORADAS ── */}
            <section className="mb-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Eye className="h-4 w-4 text-primary" />Categorias monitoradas
                  <span className="text-xs font-normal text-muted-foreground">· {monitors.length}</span>
                </h2>
                <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)}>
                  <Plus className="h-3.5 w-3.5" /><span className="ml-1">Monitorar</span>
                </Button>
              </div>

              {showForm && (
                <div className="mb-3 flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 sm:flex-row sm:items-end">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-muted-foreground">Rede</label>
                    <select
                      value={fNetwork}
                      onChange={(e) => setFNetwork(e.target.value as TrendNetwork)}
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    >
                      {NETWORKS.map((n) => (
                        <option key={n.value} value={n.value}>{n.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <label className="text-[11px] text-muted-foreground">Categoria</label>
                    <input
                      value={fCategory}
                      onChange={(e) => setFCategory(e.target.value)}
                      placeholder="ex: iluminação, decoração"
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <label className="text-[11px] text-muted-foreground">Palavras-chave (vírgula)</label>
                    <input
                      value={fKeywords}
                      onChange={(e) => setFKeywords(e.target.value)}
                      placeholder="ex: lustre, pendente, arandela"
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    />
                  </div>
                  <Button size="sm" onClick={() => void addMonitor()} disabled={saving || !fCategory.trim()}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    <span className="ml-1">Adicionar</span>
                  </Button>
                </div>
              )}

              {monitors.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                  Nenhuma categoria monitorada. Adicione uma pra o radar começar a vigiar as tendências da sua área.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {monitors.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <NetIcon source={m.network} className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{m.category}</span>
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                            {NET_LABEL[m.network] ?? m.network}
                          </span>
                          {!m.is_active && (
                            <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-500">pausado</span>
                          )}
                        </div>
                        {m.keywords.length > 0 && (
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {m.keywords.join(' · ')}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {m.last_collected_at
                          ? `coletado ${new Date(m.last_collected_at).toLocaleDateString('pt-BR')}`
                          : 'aguardando coleta'}
                      </span>
                      {(m.network === 'youtube' || m.network === 'google_trends' || m.network === 'tiktok' || m.network === 'meta_ads' || m.network === 'instagram') && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void collectMonitor(m.id)}
                          disabled={collectingId === m.id}
                          title="Coletar agora só deste monitor (ignora a trava de custo de 7 dias do Apify)"
                        >
                          {collectingId === m.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <DownloadCloud className="h-3.5 w-3.5" />
                          )}
                          <span className="ml-1 text-xs">{collectingId === m.id ? 'Coletando…' : 'Coletar'}</span>
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => void removeMonitor(m.id)} title="Remover">
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── SINAIS DE TENDÊNCIA ── */}
            <section className="mb-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <TrendingUp className="h-4 w-4 text-primary" />Sinais de tendência
              </h2>
              {fSignals.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                  Sem sinais ainda. Quando os conectores forem ligados (YouTube, Meta Ad Library, TikTok), o radar
                  vai destacar aqui os formatos, sons, temas e criativos em alta na sua categoria.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {fSignals.map((s) => (
                    <div key={s.id} className="rounded-lg border border-border bg-card p-3">
                      <div className="flex items-center gap-2">
                        <NetIcon source={s.source} className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-[13px] font-medium">{s.title}</span>
                      </div>
                      {s.summary && <p className="mt-1 text-xs text-muted-foreground">{s.summary}</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── ITENS INDIVIDUAIS (o que está bombando) ── */}
            <section className="mb-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-primary" />O que está bombando
                <span className="text-xs font-normal text-muted-foreground">· dados individuais por item</span>
              </h2>
              {fItems.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                  Nenhum item coletado ainda. Cada vídeo, criativo e som monitorado vai aparecer aqui com suas
                  métricas individuais (views, likes, duração, etc.).
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {fItems.map((it) => (
                    <a
                      key={it.id}
                      href={it.url ?? '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:bg-muted/40"
                    >
                      {it.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={trendThumbUrl(it.thumbnail_url)}
                          alt=""
                          loading="lazy"
                          className="aspect-video w-full bg-muted object-cover"
                          onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                        />
                      ) : (
                        <div className="flex aspect-video w-full items-center justify-center bg-muted">
                          <NetIcon source={it.source} className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex flex-1 flex-col gap-1 p-2">
                        <p className="line-clamp-2 text-[11px] font-medium leading-snug">{it.title ?? '(sem título)'}</p>
                        <p className="mt-auto text-[10px] text-muted-foreground">
                          {it.metrics.views != null ? `${nf(it.metrics.views)} views` : NET_LABEL[it.source] ?? it.source}
                        </p>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </section>

            {/* ── PADRÕES VENCEDORES (Engenharia Reversa) ── */}
            <section className="mb-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <FlaskConical className="h-4 w-4 text-primary" />Padrões vencedores
                <span className="text-xs font-normal text-muted-foreground">
                  · engenharia reversa · alimentam o roteirista
                </span>
              </h2>
              {fPatterns.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                  Sem padrões ainda. Minere os perfis de referência e clique em <span className="font-medium">Analisar</span> —
                  a IA decompõe os posts que mais performaram em gancho, formato, CTA e por que funcionam.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {fPatterns.map((p) => (
                    <div key={p.id} className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3">
                      <div className="flex items-center gap-2">
                        {p.hook_type && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                            {p.hook_type}
                          </span>
                        )}
                        {p.format && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{p.format}</span>
                        )}
                      </div>
                      {p.hook && <p className="text-[13px] font-medium italic leading-snug">“{p.hook}”</p>}
                      {p.structure && <p className="text-[11px] text-muted-foreground"><span className="font-medium">Estrutura:</span> {p.structure}</p>}
                      {p.why_it_works && <p className="text-[11px] leading-relaxed text-muted-foreground">{p.why_it_works}</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── PAUTAS (BRIEFS) DA IA ── */}
            <section className="mb-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Brain className="h-4 w-4 text-primary" />Pautas da IA
                <span className="text-xs font-normal text-muted-foreground">· tendência × engajamento × comércio</span>
              </h2>
              {briefs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                  Sem pautas ainda. Clique em <span className="font-medium">Gerar pautas IA</span> — a IA cruza as
                  tendências coletadas com o que engaja no seu público e os produtos com boa margem/estoque, e te diz o que postar.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {briefs.map((b) => {
                    const prods = (b.suggested_products as TrendBriefProduct[]) ?? [];
                    const prod = prods[0];
                    return (
                      <div key={b.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
                        <div className="flex items-start gap-2">
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                            {FORMAT_LABEL[b.format] ?? b.format}
                          </span>
                          {b.category && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{b.category}</span>
                          )}
                          {b.target_seconds ? (
                            <span className="flex items-center gap-0.5 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                              <Play className="h-2.5 w-2.5" />{durationLabel(b.target_seconds)}
                            </span>
                          ) : null}
                          <button
                            onClick={() => void dismissBrief(b.id)}
                            className="ml-auto text-muted-foreground hover:text-foreground"
                            title="Descartar"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <p className="text-[13px] font-semibold leading-snug">{b.title}</p>
                        {b.hook && <p className="text-xs italic text-foreground/80">“{b.hook}”</p>}
                        {b.rationale && (
                          <p className="text-xs leading-relaxed text-muted-foreground">{b.rationale}</p>
                        )}
                        {prods.length > 0 && (
                          <div className="flex items-center gap-2">
                            {prod?.photo_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={prod.photo_url} alt="" className="h-8 w-8 rounded object-cover" />
                            ) : null}
                            <span className="truncate text-[11px] text-muted-foreground">
                              {prods.map((p) => p.name).join(' · ')}
                            </span>
                          </div>
                        )}
                        {b.hashtags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {b.hashtags.slice(0, 6).map((h, i) => (
                              <span key={i} className="flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                <Hash className="h-2.5 w-2.5" />{h.replace(/^#/, '')}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="mt-auto flex flex-col gap-1.5">
                          <Button size="sm" className="w-full" asChild>
                            <Link href={briefHref(b, prod)}>
                              <Wand2 className="h-3.5 w-3.5" />
                              <span className="ml-1">Gerar conteúdo</span>
                            </Link>
                          </Button>
                          {heygenConfigured && b.script && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full"
                              onClick={() => void openHeygen(b)}
                              title="Transformar este roteiro num vídeo com avatar (HeyGen)"
                            >
                              <Clapperboard className="h-3.5 w-3.5" />
                              <span className="ml-1">Vídeo no HeyGen</span>
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* ── VÍDEOS HEYGEN (avatar a partir do roteiro) ── */}
            {(heygenConfigured || heygenJobs.length > 0) && (
              <section className="mb-6">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Clapperboard className="h-4 w-4 text-primary" />Vídeos HeyGen
                  <span className="text-xs font-normal text-muted-foreground">· roteiro da pauta → vídeo com avatar</span>
                </h2>
                {heygenJobs.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                    Nenhum vídeo gerado ainda. Em qualquer pauta com roteiro, clique em{' '}
                    <span className="font-medium">Vídeo no HeyGen</span> pra transformá-la num vídeo com avatar.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {heygenJobs.map((j) => (
                      <div key={j.id} className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
                        {j.status === 'completed' && j.video_url ? (
                          // eslint-disable-next-line jsx-a11y/media-has-caption
                          <video
                            src={j.video_url}
                            poster={j.thumbnail_url ?? undefined}
                            controls
                            className="aspect-video w-full bg-muted object-cover"
                          />
                        ) : (
                          <div className="flex aspect-video w-full flex-col items-center justify-center gap-1 bg-muted text-muted-foreground">
                            {j.status === 'failed' ? (
                              <AlertTriangle className="h-6 w-6 text-destructive" />
                            ) : (
                              <Loader2 className="h-6 w-6 animate-spin" />
                            )}
                            <span className="text-[11px]">
                              {j.status === 'failed' ? 'Falhou' : j.status === 'pending' ? 'Na fila…' : 'Gerando…'}
                            </span>
                          </div>
                        )}
                        <div className="flex flex-col gap-1 p-2">
                          <p className="line-clamp-1 text-[12px] font-medium">{j.title ?? 'Vídeo HeyGen'}</p>
                          {j.status === 'failed' && j.error && (
                            <p className="line-clamp-2 text-[10px] text-destructive">{j.error}</p>
                          )}
                          {j.status === 'completed' && j.video_url && (
                            <a
                              href={j.video_url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                            >
                              <ExternalLink className="h-3 w-3" />Abrir vídeo
                              {j.duration_sec ? ` · ${Math.round(j.duration_sec)}s` : ''}
                            </a>
                          )}
                          {j.status === 'completed' && j.video_url && (
                            j.cortes_job_id ? (
                              <Link
                                href="/social/cortes"
                                className="mt-1 flex items-center justify-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
                              >
                                <CheckCircle2 className="h-3 w-3 text-emerald-500" />Cortes em andamento — ver
                              </Link>
                            ) : (
                              <button
                                onClick={() => void gerarCortesDoHeygen(j)}
                                disabled={cortesBusyId === j.id}
                                title="Recortar este vídeo em cortes verticais (Studio de Cortes)"
                                className="mt-1 flex items-center justify-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                              >
                                {cortesBusyId === j.id ? (
                                  <><Loader2 className="h-3 w-3 animate-spin" />Enviando…</>
                                ) : (
                                  <><Scissors className="h-3 w-3" />Gerar cortes</>
                                )}
                              </button>
                            )
                          )}
                          {j.status === 'completed' && j.video_url && (
                            <button
                              onClick={() => void abrirPublicarYoutube(j)}
                              disabled={ytBusyJobId === j.id}
                              title="Publicar este vídeo no YouTube (título, descrição, capítulos e miniatura otimizados por IA)"
                              className="mt-1 flex items-center justify-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-60"
                            >
                              {ytBusyJobId === j.id ? (
                                <><Loader2 className="h-3 w-3 animate-spin" />Preparando…</>
                              ) : (
                                <><Youtube className="h-3 w-3" />Publicar no YouTube</>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            <p className="text-[11px] text-muted-foreground">
              O Radar evolui em fases: conectores YouTube + Google Trends (TR-1), Meta Ad Library + Instagram (TR-2),
              briefs de conteúdo com IA (TR-3) e TikTok (TR-5).
            </p>
          </>
        )}
      </div>

      {/* ── MODAL: publicar vídeo longo no YouTube ── */}
      {ytPub && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !ytBusy && setYtPub(null)}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Youtube className="h-5 w-5 text-red-500" />
                <div>
                  <h3 className="text-sm font-semibold leading-tight">Publicar no YouTube</h3>
                  <p className="text-[11px] text-muted-foreground">
                    Título, descrição, capítulos e miniatura otimizados por IA — revise antes de publicar.
                  </p>
                </div>
              </div>
              <button
                onClick={() => !ytBusy && setYtPub(null)}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {ytPub.status === 'published' ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                <p className="text-sm font-medium">Vídeo publicado no YouTube!</p>
                {ytPub.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ytPub.thumbnail_url} alt="capa" className="w-64 rounded-lg border border-border" />
                )}
                {ytPub.youtube_url && (
                  <a
                    href={ytPub.youtube_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <ExternalLink className="h-4 w-4" />Abrir no YouTube
                  </a>
                )}
              </div>
            ) : (
              <>
                {/* Miniatura */}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative w-full sm:w-72 shrink-0">
                    {ytPub.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={ytPub.thumbnail_url}
                        alt="miniatura"
                        className="aspect-video w-full rounded-lg border border-border object-cover"
                      />
                    ) : (
                      <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-[11px] text-muted-foreground">
                        sem miniatura
                      </div>
                    )}
                    <button
                      onClick={() => void regerarCapaYoutube()}
                      disabled={!!ytBusy}
                      className="mt-1 flex w-full items-center justify-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-60"
                    >
                      {ytBusy === 'thumb' ? (
                        <><Loader2 className="h-3 w-3 animate-spin" />Gerando capa…</>
                      ) : (
                        <><ImageIcon className="h-3 w-3" />Regerar capa por IA</>
                      )}
                    </button>
                  </div>

                  <div className="flex flex-1 flex-col gap-2">
                    {/* Canal */}
                    <label className="text-[11px] font-medium text-muted-foreground">Canal do YouTube</label>
                    {ytChannels.length === 0 ? (
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-400">
                        Nenhum canal conectado.{' '}
                        <Link href="/social/cortes" className="underline">Conecte um canal</Link> (aba YouTube) e tente de novo.
                      </div>
                    ) : (
                      <select
                        value={ytForm.channel}
                        onChange={(e) => setYtForm((f) => ({ ...f, channel: e.target.value }))}
                        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                      >
                        {ytChannels.map((c) => (
                          <option key={c.id} value={c.id}>{c.title ?? c.youtube_channel_id}</option>
                        ))}
                      </select>
                    )}

                    {/* Privacidade */}
                    <label className="text-[11px] font-medium text-muted-foreground">Privacidade</label>
                    <select
                      value={ytForm.privacy}
                      onChange={(e) => setYtForm((f) => ({ ...f, privacy: e.target.value as YTPrivacy }))}
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    >
                      <option value="public">Público</option>
                      <option value="unlisted">Não listado</option>
                      <option value="private">Privado</option>
                    </select>

                    {/* Capítulos (informativo — já vão na descrição) */}
                    {ytPub.chapters?.length > 0 && (
                      <div className="rounded-md border border-border bg-muted/20 p-2">
                        <p className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Capítulos</p>
                        <ul className="space-y-0.5">
                          {ytPub.chapters.map((c, i) => (
                            <li key={i} className="text-[11px]">
                              <span className="font-mono text-primary">{c.t}</span> {c.label}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                {/* Título */}
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground">Título (até 100 caracteres)</label>
                  <input
                    value={ytForm.title}
                    maxLength={100}
                    onChange={(e) => setYtForm((f) => ({ ...f, title: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  />
                </div>

                {/* Descrição */}
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground">
                    Descrição (capítulos, links e hashtags já incluídos)
                  </label>
                  <textarea
                    value={ytForm.description}
                    onChange={(e) => setYtForm((f) => ({ ...f, description: e.target.value }))}
                    rows={9}
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono"
                  />
                </div>

                {/* Tags */}
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground">Tags (separadas por vírgula)</label>
                  <input
                    value={ytForm.tagsText}
                    onChange={(e) => setYtForm((f) => ({ ...f, tagsText: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  />
                </div>

                {ytPub.status === 'failed' && ytPub.error && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
                    Tentativa anterior falhou: {ytPub.error}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    onClick={() => void salvarRascunhoYoutube()}
                    disabled={!!ytBusy}
                    className="flex items-center gap-1 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
                  >
                    {ytBusy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Salvar rascunho
                  </button>
                  <button
                    onClick={() => void publicarNoYoutube()}
                    disabled={!!ytBusy || ytChannels.length === 0}
                    className="flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {ytBusy === 'publish' ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" />Publicando…</>
                    ) : (
                      <><Send className="h-3.5 w-3.5" />Publicar agora</>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL: gerar vídeo no HeyGen a partir da pauta ── */}
      {hgBrief && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !hgCreating && setHgBrief(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clapperboard className="h-5 w-5 text-primary" />
                <div>
                  <h3 className="text-sm font-semibold leading-tight">Gerar vídeo no HeyGen</h3>
                  <p className="text-[11px] text-muted-foreground line-clamp-1">{hgBrief.title}</p>
                </div>
              </div>
              <button
                onClick={() => !hgCreating && setHgBrief(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {hgLoadingOpts ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando templates, avatares e vozes…
              </div>
            ) : !hgOptions?.configured ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-foreground/80">
                HeyGen não configurado. Defina a <span className="font-mono">HEYGEN_API_KEY</span> na active-api pra liberar a geração de vídeo com avatar.
              </div>
            ) : hgOptions.avatars.length === 0 && hgOptions.voices.length === 0 && hgOptions.templates.length === 0 ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-foreground/80">
                Sua conta HeyGen não retornou templates/avatares/vozes. Verifique o plano e as permissões da chave.
              </div>
            ) : (
              <>
                {hgOptions.templates.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-muted-foreground">Template (ambiente fixo)</label>
                    <select
                      value={hgTemplate}
                      onChange={(e) => setHgTemplate(e.target.value)}
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    >
                      {hgOptions.templates.map((t) => (
                        <option key={t.template_id} value={t.template_id}>
                          {t.name ?? t.template_id}
                        </option>
                      ))}
                      <option value="">— Avatar + voz avulsos —</option>
                    </select>
                  </div>
                )}
                {hgTemplate && (
                  <p className="rounded-md border border-primary/30 bg-primary/5 p-2 text-[11px] text-foreground/80">
                    Usando o template selecionado: avatar, fundo e ambiente vêm dele. Só o roteiro é injetado — escolha a voz abaixo (o HeyGen exige uma voz pra fala do template).
                  </p>
                )}
                {!hgTemplate && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-muted-foreground">Avatar</label>
                    <select
                      value={hgAvatar}
                      onChange={(e) => setHgAvatar(e.target.value)}
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    >
                      {hgOptions.avatars.map((a) => (
                        <option key={a.avatar_id} value={a.avatar_id}>
                          {a.name ?? a.avatar_id}{a.gender ? ` · ${a.gender}` : ''}{a.premium ? ' · premium' : ''}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-muted-foreground">
                      Os avatares marcados “(foto)” são os foto-avatares da marca (ex.: Vazzo) — só eles aceitam o cenário e-Click.
                    </p>
                  </div>
                )}
                {/* Cenário e-Click: recorta o avatar e usa o fundo da marca. */}
                {!hgTemplate && (
                  <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-muted/20 p-2.5">
                    <input
                      type="checkbox"
                      checked={hgBrandScene}
                      onChange={(e) => setHgBrandScene(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-primary"
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-1 text-[12px] font-medium">
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                        Cenário e-Click (fundo da marca)
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        Recorta o avatar e o coloca na cena da marca (estante e-Click). Funciona com foto-avatares (Vazzo); com avatar comum, usa o foto-avatar padrão da marca.
                      </span>
                    </span>
                  </label>
                )}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-muted-foreground">Voz</label>
                  <select
                    value={hgVoice}
                    onChange={(e) => setHgVoice(e.target.value)}
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  >
                    {hgOptions.voices.map((v) => (
                      <option key={v.voice_id} value={v.voice_id}>
                        {v.name ?? v.voice_id}{v.language ? ` · ${v.language}` : ''}{v.gender ? ` · ${v.gender}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  A narração do roteiro será falada pelo avatar (timestamps e rubricas de cena são removidos automaticamente). A geração tem custo no HeyGen.
                </p>

                {/* Automação completa: ao concluir o vídeo, gerar cortes verticais. */}
                <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-muted/20 p-2.5">
                  <input
                    type="checkbox"
                    checked={hgAutoCortes}
                    onChange={(e) => setHgAutoCortes(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-1 text-[12px] font-medium">
                      <Scissors className="h-3.5 w-3.5 text-primary" />
                      Automação completa — gerar cortes ao concluir
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      Quando o vídeo ficar pronto, o Studio de Cortes recorta automaticamente em vídeos verticais.
                      Em validação: fica registrado, mas o disparo automático só roda após liberarmos a automação
                      (você pode gerar os cortes manualmente no card a qualquer momento).
                    </span>
                  </span>
                </label>

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setHgBrief(null)} disabled={hgCreating}>
                    Cancelar
                  </Button>
                  <Button size="sm" onClick={() => void createHeygen()} disabled={hgCreating || !hgVoice || (!hgTemplate && !hgAvatar)}>
                    {hgCreating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clapperboard className="h-3.5 w-3.5" />}
                    <span className="ml-1">{hgCreating ? 'Enviando…' : 'Gerar vídeo'}</span>
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
