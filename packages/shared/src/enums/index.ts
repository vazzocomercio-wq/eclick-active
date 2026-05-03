// ============================================================
// e-Click Active — Enum union types
// Mirrors all CHECK constraints from supabase/migrations/001_foundation_schema.sql
// ============================================================

// ── Identity & Access ──

export type Plan = 'starter' | 'professional' | 'enterprise';

export type OrgMemberRole = 'owner' | 'admin' | 'manager' | 'agent' | 'viewer';

export type OrgMemberStatus = 'active' | 'invited' | 'suspended';

// ── Contacts ──

export type CompanySize = 'micro' | 'small' | 'medium' | 'large' | 'enterprise';

export type ContactTemperature = 'cold' | 'warm' | 'hot' | 'very_hot';

export type ContactSource =
  | 'whatsapp'
  | 'instagram'
  | 'email'
  | 'website'
  | 'import'
  | 'manual'
  | 'referral';

// ── Channels ──

export type ChannelType =
  | 'whatsapp'
  | 'whatsapp_free'
  | 'instagram'
  | 'messenger'
  | 'telegram'
  | 'email'
  | 'webchat'
  | 'tiktok'
  | 'mercadolivre';

export type ChannelStatus =
  | 'active'
  | 'paused'
  | 'error'
  | 'pending'
  | 'disconnected';

// ── Conversations ──

export type ConversationStatus =
  | 'open'
  | 'pending'
  | 'snoozed'
  | 'resolved'
  | 'closed'
  | 'archived';

export type ConversationPriority = 'low' | 'normal' | 'high' | 'urgent';

export type AISentiment =
  | 'very_positive'
  | 'positive'
  | 'neutral'
  | 'negative'
  | 'very_negative';

// ── Messages ──

export type MessageDirection = 'inbound' | 'outbound';

export type MessageSenderType = 'contact' | 'agent' | 'bot' | 'system';

export type MessageContentType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'template'
  | 'location'
  | 'sticker'
  | 'reaction'
  | 'interactive'
  | 'system';

export type MessageDeliveryStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed';

export type MessageTemplateCategory = 'marketing' | 'utility' | 'authentication';

export type MessageTemplateStatus = 'draft' | 'pending' | 'approved' | 'rejected';

// ── Pipelines & Deals ──

export type DealRisk = 'low' | 'medium' | 'high' | 'critical';

// ── Tasks ──

export type TaskType =
  | 'call'
  | 'email'
  | 'meeting'
  | 'follow_up'
  | 'whatsapp'
  | 'proposal'
  | 'custom';

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'overdue';

// ── Automations ──

export type AutomationTriggerType =
  | 'message_received'
  | 'deal_created'
  | 'deal_stage_changed'
  | 'contact_created'
  | 'task_overdue'
  | 'time_based'
  | 'manual'
  | 'webhook';

export type AutomationLogStatus = 'success' | 'partial' | 'failed';

// ── Knowledge Base ──

export type KnowledgeCategory =
  | 'general'
  | 'products'
  | 'pricing'
  | 'policies'
  | 'faq'
  | 'scripts'
  | 'objections'
  | 'procedures';

// ── AI ──

export type AIInteractionType =
  | 'classify_intent'
  | 'suggest_response'
  | 'summarize'
  | 'sentiment'
  | 'lead_score'
  | 'copilot'
  | 'audit'
  | 'diagnose'
  | 'train'
  | 'auto_respond'
  | 'generate_automation';

export type AIProvider = 'anthropic' | 'openai';

export type AIFeatureName =
  | 'auto_classify'
  | 'suggest_response'
  | 'auto_respond'
  | 'summarize'
  | 'sentiment'
  | 'lead_scoring'
  | 'copilot'
  | 'audit'
  | 'follow_up_agent'
  | 'train_agent';

// ── Notifications ──

export type NotificationType =
  | 'new_message'
  | 'deal_update'
  | 'task_due'
  | 'task_overdue'
  | 'ai_insight'
  | 'automation_executed'
  | 'mention'
  | 'assignment'
  | 'system';

export type NotificationSeverity = 'info' | 'warning' | 'urgent' | 'success';

export type NotificationEntityType = 'conversation' | 'deal' | 'task' | 'contact';

// ── Timeline events (contact_timeline.event_type) ──

export type ContactTimelineEventType =
  | 'message_received'
  | 'message_sent'
  | 'deal_created'
  | 'deal_won'
  | 'deal_lost'
  | 'stage_changed'
  | 'task_completed'
  | 'note_added'
  | 'tag_added'
  | 'score_changed'
  | 'ai_insight'
  | 'channel_connected'
  | 'form_submitted';

// ── Deal activity types (deal_activities.activity_type) ──

export type DealActivityType =
  | 'stage_changed'
  | 'value_changed'
  | 'assigned'
  | 'note_added'
  | 'task_created'
  | 'email_sent'
  | 'call_made'
  | 'meeting_scheduled'
  | 'proposal_sent'
  | 'ai_insight';
