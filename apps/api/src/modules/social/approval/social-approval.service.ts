import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { SupabaseService } from '../../../common/supabase/supabase.service';

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export interface SocialApprovalStage {
  id: string;
  org_id: string;
  content_id: string;
  reviewer_name: string;
  reviewer_email: string | null;
  stage_label: string;
  access_token: string;
  expires_at: string;
  status: ApprovalStatus;
  decision_at: string | null;
  decision_notes: string | null;
  created_by: string | null;
  viewed_at: string | null;
  view_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PublicReviewView {
  stage: {
    id: string;
    reviewer_name: string;
    stage_label: string;
    status: ApprovalStatus;
    expires_at: string;
  };
  content: {
    id: string;
    content_type: string;
    title: string | null;
    caption: string | null;
    hashtags: string[];
    cta: string | null;
    cover_image_url: string | null;
    media: unknown;
    slides: unknown;
  };
  brand: {
    name: string;
    logo_url: string | null;
    primary_color: string;
    secondary_color: string;
  };
}

interface CreateStageDto {
  content_id: string;
  reviewer_name: string;
  reviewer_email?: string;
  stage_label?: string;
  duration_days?: number;
}

const TOKEN_BYTES = 32; // 64 chars hex — entropy alta o suficiente

@Injectable()
export class SocialApprovalService {
  private readonly log = new Logger(SocialApprovalService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ─── Operações internas (com auth) ───────────────

  async create(
    orgId: string,
    actorId: string | null,
    dto: CreateStageDto,
  ): Promise<SocialApprovalStage> {
    if (!dto.content_id || !dto.reviewer_name) {
      throw new BadRequestException('content_id e reviewer_name obrigatórios');
    }
    const expiresAt = new Date(
      Date.now() + (dto.duration_days ?? 7) * 86_400_000,
    ).toISOString();
    const token = randomBytes(TOKEN_BYTES).toString('hex');

    const { data, error } = await this.supabase.adminClient
      .from('social_approval_stages')
      .insert({
        org_id: orgId,
        content_id: dto.content_id,
        reviewer_name: dto.reviewer_name,
        reviewer_email: dto.reviewer_email ?? null,
        stage_label: dto.stage_label ?? 'Cliente',
        access_token: token,
        expires_at: expiresAt,
        status: 'pending' as ApprovalStatus,
        created_by: actorId,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as SocialApprovalStage;
  }

  async listForContent(
    orgId: string,
    contentId: string,
  ): Promise<SocialApprovalStage[]> {
    const { data } = await this.supabase.adminClient
      .from('social_approval_stages')
      .select('*')
      .eq('org_id', orgId)
      .eq('content_id', contentId)
      .order('created_at', { ascending: false });
    return (data ?? []) as SocialApprovalStage[];
  }

  async cancel(orgId: string, id: string): Promise<SocialApprovalStage> {
    const { data, error } = await this.supabase.adminClient
      .from('social_approval_stages')
      .update({ status: 'cancelled' as ApprovalStatus })
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as SocialApprovalStage;
  }

  buildPublicUrl(token: string): string {
    const base = process.env.PUBLIC_APP_URL ?? '';
    return `${base}/aprovar/${token}`;
  }

  // ─── Operações públicas (com token, sem auth) ─────

  async getByToken(token: string): Promise<PublicReviewView> {
    const stage = await this.findStageByToken(token);

    // Atualiza view tracking (best-effort)
    void this.supabase.adminClient
      .from('social_approval_stages')
      .update({
        viewed_at: new Date().toISOString(),
        view_count: stage.view_count + 1,
      })
      .eq('id', stage.id)
      .then(() => undefined);

    // Carrega content + brand
    const { data: contentRow } = await this.supabase.adminClient
      .from('social_contents')
      .select(
        'id, content_type, title, caption, hashtags, cta, cover_image_url, media, slides, brand_id',
      )
      .eq('id', stage.content_id)
      .maybeSingle();
    if (!contentRow) {
      throw new NotFoundException('Conteúdo não encontrado');
    }
    const content = contentRow as {
      id: string;
      content_type: string;
      title: string | null;
      caption: string | null;
      hashtags: string[];
      cta: string | null;
      cover_image_url: string | null;
      media: unknown;
      slides: unknown;
      brand_id: string;
    };

    const { data: brandRow } = await this.supabase.adminClient
      .from('social_brands')
      .select('name, logo_url, primary_color, secondary_color')
      .eq('id', content.brand_id)
      .maybeSingle();
    const brand = (brandRow as PublicReviewView['brand'] | null) ?? {
      name: 'Marca',
      logo_url: null,
      primary_color: '#00E5FF',
      secondary_color: '#4ADE50',
    };

    return {
      stage: {
        id: stage.id,
        reviewer_name: stage.reviewer_name,
        stage_label: stage.stage_label,
        status: stage.status,
        expires_at: stage.expires_at,
      },
      content,
      brand,
    };
  }

  async decide(
    token: string,
    decision: 'approved' | 'rejected',
    notes?: string,
  ): Promise<{ ok: true }> {
    const stage = await this.findStageByToken(token);
    if (stage.status !== 'pending') {
      throw new BadRequestException('Decisão já foi tomada nesse estágio');
    }
    if (new Date(stage.expires_at) < new Date()) {
      throw new BadRequestException('Link expirado');
    }
    await this.supabase.adminClient
      .from('social_approval_stages')
      .update({
        status: decision,
        decision_at: new Date().toISOString(),
        decision_notes: notes?.slice(0, 1000) ?? null,
      })
      .eq('id', stage.id);
    return { ok: true };
  }

  // ─── helpers ────────────────────────────────────

  private async findStageByToken(
    token: string,
  ): Promise<SocialApprovalStage> {
    const { data } = await this.supabase.adminClient
      .from('social_approval_stages')
      .select('*')
      .eq('access_token', token)
      .maybeSingle();
    if (!data) throw new NotFoundException('Token inválido ou expirado');
    const stage = data as SocialApprovalStage;
    // Auto-marca expired se passou da data
    if (
      stage.status === 'pending' &&
      new Date(stage.expires_at) < new Date()
    ) {
      await this.supabase.adminClient
        .from('social_approval_stages')
        .update({ status: 'expired' })
        .eq('id', stage.id);
      stage.status = 'expired';
    }
    return stage;
  }
}
