import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { ContactsService, PaginatedResult } from './contacts.service';
import { WhatsappValidatorService } from './whatsapp-validator.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { ListContactsQueryDto } from './dto/list-contacts.query.dto';
import { SearchContactsQueryDto } from './dto/search-contacts.query.dto';
import type { Contact, WhatsAppCheckResult } from '@eclick-active/shared';

interface VerifyBatchDto {
  contact_ids: string[];
}

interface VerifyByPhoneDto {
  phone: string;
}

@UseGuards(AuthGuard)
@Controller('contacts')
export class ContactsController {
  constructor(
    private readonly service: ContactsService,
    private readonly whatsappValidator: WhatsappValidatorService,
  ) {}

  // GET /contacts/search?q=...&limit=...
  // Definido ANTES de /:id pra não colidir com a rota dinâmica.
  @Get('search')
  search(
    @CurrentUser() user: AuthUser,
    @Query() query: SearchContactsQueryDto,
  ): Promise<Contact[]> {
    return this.service.search(user.org_id, query.q, query.limit);
  }

  // GET /contacts/whatsapp-stats — métricas de validação
  // Antes de /:id pra não cair no ParseUUIDPipe
  @Get('whatsapp-stats')
  whatsappStats(@CurrentUser() user: AuthUser) {
    return this.whatsappValidator.getStats(user.org_id);
  }

  /**
   * Validação sob demanda — usuário clicou no badge "?" do contato.
   * Síncrono: faz a checagem agora e retorna o resultado.
   */
  @Post(':id/verify-whatsapp')
  async verifyWhatsapp(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ok: boolean; result: WhatsAppCheckResult | null }> {
    const contact = await this.service.findById(user.org_id, id);
    if (!contact.phone) {
      return { ok: false, result: null };
    }
    const result = await this.whatsappValidator.validatePhone(
      user.org_id,
      id,
      contact.phone,
    );
    return { ok: !!result, result };
  }

  /**
   * Preview de validação por phone solto (sem contactId). Usado pelo
   * form de cadastro pra checar se o número é WhatsApp ANTES de criar
   * o contato. Não persiste nada — só consulta o provider.
   */
  @Post('verify-whatsapp-by-phone')
  async verifyWhatsappByPhone(
    @CurrentUser() user: AuthUser,
    @Body() dto: VerifyByPhoneDto,
  ): Promise<{ ok: boolean; result: WhatsAppCheckResult | null }> {
    const phone = (dto?.phone ?? '').trim();
    if (!phone || phone.replace(/\D/g, '').length < 8) {
      return { ok: false, result: null };
    }
    const result = await this.whatsappValidator.previewByPhone(user.org_id, phone);
    return { ok: !!result, result };
  }

  /**
   * Validação em batch — enfileira N contatos pra serem validados em
   * background respeitando rate limit do provider.
   */
  @Post('verify-whatsapp/batch')
  @HttpCode(HttpStatus.ACCEPTED)
  async verifyWhatsappBatch(
    @CurrentUser() user: AuthUser,
    @Body() dto: VerifyBatchDto,
  ): Promise<{ enqueued: number }> {
    if (!Array.isArray(dto?.contact_ids) || dto.contact_ids.length === 0) {
      return { enqueued: 0 };
    }
    let enqueued = 0;
    for (const id of dto.contact_ids) {
      try {
        const c = await this.service.findById(user.org_id, id);
        if (c.phone) {
          await this.whatsappValidator.enqueue(user.org_id, id, c.phone);
          enqueued += 1;
        }
      } catch {
        // contato inexistente / outra org — ignora silenciosamente
      }
    }
    return { enqueued };
  }

  // GET /contacts?page=&limit=&search=&temperature=&tags=
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() filters: ListContactsQueryDto,
  ): Promise<PaginatedResult<Contact>> {
    return this.service.findAll(user.org_id, filters);
  }

  // GET /contacts/:id
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Contact> {
    return this.service.findById(user.org_id, id);
  }

  // GET /contacts/:id/deals — deals abertos do contato com pipeline+stage
  // resolvidos (pra UI do drawer da conversa exibir "Funil & Etapa")
  @Get(':id/deals')
  listDeals(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Awaited<ReturnType<ContactsService['listDealsForContact']>>> {
    return this.service.listDealsForContact(user.org_id, id);
  }

  // POST /contacts
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateContactDto,
  ): Promise<Contact> {
    return this.service.create(user.org_id, dto);
  }

  // PATCH /contacts/:id
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContactDto,
  ): Promise<Contact> {
    return this.service.update(user.org_id, id, dto);
  }

  // DELETE /contacts/:id
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.delete(user.org_id, id);
  }

  // GET /contacts/:id/timeline — eventos da timeline do contato
  @Get(':id/timeline')
  timeline(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getTimeline(user.org_id, id);
  }

  // GET /contacts/:id/deals — deals vinculados ao contato
  @Get(':id/deals')
  deals(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getDeals(user.org_id, id);
  }
}
