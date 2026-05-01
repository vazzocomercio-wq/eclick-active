import { CreateContactDto } from './create-contact.dto';

/**
 * Atualização parcial. Como toda field do CreateContactDto já é @IsOptional,
 * herdar é suficiente — não precisamos de PartialType.
 */
export class UpdateContactDto extends CreateContactDto {}
