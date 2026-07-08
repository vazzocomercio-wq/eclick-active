/**
 * Arrays runtime dos enums do SAC — espelham os `type` union de sac.types.ts
 * e os CHECK constraints da M053. Necessários pra validação com class-validator
 * (@IsIn precisa de valor em runtime; os `type` são apagados no compile).
 */
import type {
  SacCategory,
  SacPriority,
  SacStatus,
  SacDepartment,
  SacReputationRisk,
  SacResolutionType,
  SacSentiment,
} from '../sac.types';

export const SAC_CATEGORIES: readonly SacCategory[] = [
  'pre_sale',
  'post_sale',
  'order_status',
  'delivery_delay',
  'exchange',
  'return',
  'warranty',
  'cancellation',
  'refund',
  'defective_product',
  'wrong_product',
  'missing_parts',
  'invoice',
  'payment',
  'technical',
  'complaint',
  'mediation',
  'negative_review',
  'general',
];

export const SAC_STATUSES: readonly SacStatus[] = [
  'new',
  'in_progress',
  'waiting_customer',
  'waiting_internal',
  'resolved',
  'reopened',
  'cancelled',
];

export const SAC_PRIORITIES: readonly SacPriority[] = [
  'low',
  'normal',
  'high',
  'critical',
  'reputation_risk',
];

export const SAC_REPUTATION_RISKS: readonly SacReputationRisk[] = [
  'none',
  'low',
  'medium',
  'high',
  'critical',
];

export const SAC_DEPARTMENTS: readonly SacDepartment[] = [
  'sales',
  'support',
  'logistics',
  'finance',
  'management',
];

export const SAC_RESOLUTION_TYPES: readonly SacResolutionType[] = [
  'resolved',
  'refunded',
  'exchanged',
  'returned',
  'cancelled',
  'escalated',
  'no_action_needed',
  'duplicate',
];

export const SAC_SENTIMENTS: readonly SacSentiment[] = [
  'positive',
  'neutral',
  'frustrated',
  'angry',
  'very_angry',
];
