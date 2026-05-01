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

// Enum union types
export * from './enums';

// DTOs
export * from './dto';

// Constants (PLAN_LIMITS, BRAND_COLORS, defaults)
export * from './constants';
