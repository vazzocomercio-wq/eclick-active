import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  HttpException,
  Headers,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { FormPublic } from '@eclick-active/shared';
import { FormsService } from './forms.service';
import { FormProcessorService } from './form-processor.service';
import { SubmitFormDto } from './dto/form.dto';

const RATE_LIMIT_PER_HOUR = 10;

interface IpRateBucket {
  count: number;
  windowStart: number;
}

@Controller('public/forms')
export class FormsPublicController {
  /** Rate limit em memória — (slug, ip) → bucket de 1h. */
  private readonly rateLimits = new Map<string, IpRateBucket>();

  constructor(
    private readonly forms: FormsService,
    private readonly processor: FormProcessorService,
  ) {}

  @Get(':slug')
  async getBySlug(@Param('slug') slug: string): Promise<FormPublic> {
    const form = await this.forms.findActiveBySlug(slug);
    if (!form) {
      throw new NotFoundException('Este formulário não está disponível no momento');
    }
    return this.forms.toPublic(form);
  }

  @Post(':slug/submit')
  @HttpCode(HttpStatus.OK)
  async submit(
    @Param('slug') slug: string,
    @Body() dto: SubmitFormDto,
    @Headers('x-forwarded-for') xff: string | undefined,
    @Headers('user-agent') ua: string | undefined,
    @Req() req: Request,
  ): Promise<{ success: true; submission_id: string; redirect_url?: string; success_message?: string }> {
    const form = await this.forms.findActiveBySlug(slug);
    if (!form) {
      throw new NotFoundException('Formulário indisponível');
    }

    const ip = (xff?.split(',')[0]?.trim() ?? req.ip ?? 'unknown').slice(0, 64);

    // Rate limit por (slug, ip)
    if (!this.checkRateLimit(slug, ip)) {
      throw new HttpException(
        'Muitas tentativas. Tente novamente em 1 hora.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Validação básica de required fields
    const missing: string[] = [];
    for (const f of form.fields) {
      if (f.required && (f.type === 'heading' || f.type === 'divider' || f.type === 'paragraph')) {
        continue;
      }
      if (f.required) {
        const v = dto.data[f.id];
        if (v === undefined || v === null || v === '') missing.push(f.label);
      }
    }
    if (missing.length > 0) {
      throw new HttpException(
        `Campos obrigatórios faltando: ${missing.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.processor.processSubmission(form, {
      orgId: form.org_id,
      formId: form.id,
      data: dto.data,
      source: dto.source ?? 'link',
      ipAddress: ip,
      userAgent: ua?.slice(0, 500),
      utm: {
        source: dto.utm_source,
        medium: dto.utm_medium,
        campaign: dto.utm_campaign,
        content: dto.utm_content,
        term: dto.utm_term,
      },
    });

    return {
      success: true,
      submission_id: result.submission_id,
      ...(form.settings.redirect_url ? { redirect_url: form.settings.redirect_url } : {}),
      ...(form.settings.success_message ? { success_message: form.settings.success_message } : {}),
    };
  }

  // ────────────────────────────────────────────

  private checkRateLimit(slug: string, ip: string): boolean {
    const key = `${slug}::${ip}`;
    const now = Date.now();
    const bucket = this.rateLimits.get(key);
    const windowMs = 60 * 60 * 1000;
    if (!bucket || now - bucket.windowStart > windowMs) {
      this.rateLimits.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (bucket.count >= RATE_LIMIT_PER_HOUR) return false;
    bucket.count += 1;
    return true;
  }
}
