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
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { ListContactsQueryDto } from './dto/list-contacts.query.dto';
import { SearchContactsQueryDto } from './dto/search-contacts.query.dto';
import type { Contact } from '@eclick-active/shared';

@UseGuards(AuthGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly service: ContactsService) {}

  // GET /contacts/search?q=...&limit=...
  // Definido ANTES de /:id pra não colidir com a rota dinâmica.
  @Get('search')
  search(
    @CurrentUser() user: AuthUser,
    @Query() query: SearchContactsQueryDto,
  ): Promise<Contact[]> {
    return this.service.search(user.org_id, query.q, query.limit);
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
