// ============================================================
// @eclick-active/shared — public surface
// ============================================================

// Common helpers
export type { Json, ISODateString, ISODateOnly, UUID } from './types/common';

// Domain types
export * from './types/organization';
export * from './types/contact';
export * from './types/conversation';
export * from './types/message';
export * from './types/channel';
export * from './types/pipeline';
export * from './types/task';
export * from './types/automation';
export * from './types/knowledge';
export * from './types/ai';
export * from './types/analytics';
export * from './types/notification';
export * from './types/custom-fields';
export * from './types/webhook';
export * from './types/ai-persona';
export * from './types/ai-skill';
export * from './types/knowledge-live-source';
export * from './types/appointment';
export * from './types/calendar-integration';
export * from './types/email-thread';
export * from './types/tiktok-interaction';
export * from './types/form';
export * from './types/page';
export * from './types/tag-definition';

// Enum union types
export * from './enums';

// DTOs
export * from './dto';

// Constants (PLAN_LIMITS, BRAND_COLORS, defaults)
export * from './constants';

// Utils
export * from './utils/placeholder-resolver';

// Onboarding templates por nicho
export * from './persona-templates';
