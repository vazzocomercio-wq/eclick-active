import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { SocialAiGeneratorService } from '../social-ai/social-ai-generator.service';
import { SocialMetricsService } from '../analytics/social-metrics.service';
import type { ContentPillar, ContentType } from '../social.types';

export type AbTestStatus = 'draft' | 'running' | 'completed' | 'cancelled';
export type WinnerVariant = 'a' | 'b' | 'tie';

export interface SocialAbTest {
  id: string;
  org_id: string;
  brand_id: string;
  name: string;
  hypothesis: string | null;
  variant_a_content_id: string;
  variant_b_content_id: string;
  test_duration_days: number;
  status: AbTestStatus;
  winner_variant: WinnerVariant | null;
  winner_content_id: string | null;
  variant_a_engagement_rate: number | null;
  variant_b_engagement_rate: number | null;
  decision_rationale: string | null;
  started_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface CreateAbTestDto {
  brand_id: string;
  name: string;
  hypothesis?: string;
  theme: string;
  pillar?: ContentPillar;
  content_type?: ContentType; // 'post' | 'carousel'
  test_duration_days?: number;
}

@Injectable()
export class SocialAbTestService {
  private readonly log = new Logger(SocialAbTestService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly ai: SocialAiGeneratorService,
    private readonly metrics: SocialMetricsService,
  ) {}

  /**
   * Cria A/B test gerando 2 variantes do mesmo brief com instruções
   * diferentes pra IA divergir nas estratégias.
   */
  async createTest(
    orgId: string,
    dto: CreateAbTestDto,
  ): Promise<SocialAbTest> {
    if (!dto.brand_id || !dto.name || !dto.theme) {
      throw new BadRequestException('brand_id, name e theme obrigatórios');
    }
    const contentType = dto.content_type ?? 'post';

    // Gera 2 variantes em paralelo. Pra divergir mais, mando hooks
    // sutilmente diferentes — Variante A: foco no benefício,
    // Variante B: foco na dor.
    const themeA = `${dto.theme} (variante A: começar com benefício/aspiração)`;
    const themeB = `${dto.theme} (variante B: começar com dor/problema)`;

    const generateOne = (theme: string, hook: string) =>
      contentType === 'carousel'
        ? this.ai.createAndGenerateCarousel(orgId, {
            brand_id: dto.brand_id,
            theme,
            pillar: dto.pillar,
            hook,
          })
        : this.ai.createAndGeneratePost(orgId, {
            brand_id: dto.brand_id,
            theme,
            pillar: dto.pillar,
            hook,
          });

    const [variantA, variantB] = await Promise.all([
      generateOne(themeA, 'Foco no benefício final'),
      generateOne(themeB, 'Começar com a dor do público'),
    ]);

    const { data, error } = await this.supabase.adminClient
      .from('social_ab_tests')
      .insert({
        org_id: orgId,
        brand_id: dto.brand_id,
        name: dto.name,
        hypothesis: dto.hypothesis ?? null,
        variant_a_content_id: variantA.id,
        variant_b_content_id: variantB.id,
        test_duration_days: dto.test_duration_days ?? 7,
        status: 'draft' as AbTestStatus,
      })
      .select('*')
      .single();
    if (error) throw error;

    // Marca contents como sendo de A/B test (metadata)
    await this.supabase.adminClient
      .from('social_contents')
      .update({
        metadata: { ab_test: { id: (data as SocialAbTest).id, variant: 'a' } },
      })
      .eq('id', variantA.id);
    await this.supabase.adminClient
      .from('social_contents')
      .update({
        metadata: { ab_test: { id: (data as SocialAbTest).id, variant: 'b' } },
      })
      .eq('id', variantB.id);

    return data as SocialAbTest;
  }

  async start(orgId: string, testId: string): Promise<SocialAbTest> {
    const test = await this.findById(orgId, testId);
    if (test.status !== 'draft') {
      throw new BadRequestException('Test só pode iniciar de draft');
    }
    return this.update(orgId, testId, {
      status: 'running',
      started_at: new Date().toISOString(),
    });
  }

  /**
   * Avalia o vencedor: pega métricas dos 2 contents na janela de teste,
   * compara engagement_rate médio. Decide vencedor (a/b/tie) com
   * rationale humano.
   */
  async evaluate(orgId: string, testId: string): Promise<SocialAbTest> {
    const test = await this.findById(orgId, testId);
    if (test.status !== 'running') {
      throw new BadRequestException('Só evalua tests em running');
    }

    const [metricsA, metricsB] = await Promise.all([
      this.metrics.getMetricsForContent(orgId, test.variant_a_content_id),
      this.metrics.getMetricsForContent(orgId, test.variant_b_content_id),
    ]);

    const avg = (rows: Array<{ engagement_rate: number }>) =>
      rows.length === 0
        ? 0
        : rows.reduce((s, x) => s + x.engagement_rate, 0) / rows.length;
    const erA = avg(metricsA);
    const erB = avg(metricsB);

    let winner: WinnerVariant;
    let winnerContentId: string | null;
    let rationale: string;

    if (Math.abs(erA - erB) < 0.005) {
      winner = 'tie';
      winnerContentId = null;
      rationale = `Empate técnico. A=${(erA * 100).toFixed(2)}%, B=${(erB * 100).toFixed(2)}% (diferença <0.5%).`;
    } else if (erA > erB) {
      winner = 'a';
      winnerContentId = test.variant_a_content_id;
      rationale = `Variante A vence: ${(erA * 100).toFixed(2)}% vs ${(erB * 100).toFixed(2)}%. Performou ${((erA / Math.max(erB, 0.0001) - 1) * 100).toFixed(0)}% melhor.`;
    } else {
      winner = 'b';
      winnerContentId = test.variant_b_content_id;
      rationale = `Variante B vence: ${(erB * 100).toFixed(2)}% vs ${(erA * 100).toFixed(2)}%. Performou ${((erB / Math.max(erA, 0.0001) - 1) * 100).toFixed(0)}% melhor.`;
    }

    return this.update(orgId, testId, {
      status: 'completed' as AbTestStatus,
      winner_variant: winner,
      winner_content_id: winnerContentId,
      variant_a_engagement_rate: Number(erA.toFixed(4)),
      variant_b_engagement_rate: Number(erB.toFixed(4)),
      decision_rationale: rationale,
      completed_at: new Date().toISOString(),
    });
  }

  async cancel(orgId: string, testId: string): Promise<SocialAbTest> {
    return this.update(orgId, testId, { status: 'cancelled' });
  }

  async list(orgId: string, filters: { status?: AbTestStatus; brand_id?: string } = {}): Promise<SocialAbTest[]> {
    let q = this.supabase.adminClient
      .from('social_ab_tests')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.brand_id) q = q.eq('brand_id', filters.brand_id);
    const { data } = await q;
    return (data ?? []) as SocialAbTest[];
  }

  async findById(orgId: string, id: string): Promise<SocialAbTest> {
    const { data } = await this.supabase.adminClient
      .from('social_ab_tests')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();
    if (!data) throw new NotFoundException('A/B test não encontrado');
    return data as SocialAbTest;
  }

  private async update(
    orgId: string,
    id: string,
    patch: Partial<SocialAbTest>,
  ): Promise<SocialAbTest> {
    const { data, error } = await this.supabase.adminClient
      .from('social_ab_tests')
      .update(patch)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as SocialAbTest;
  }
}
