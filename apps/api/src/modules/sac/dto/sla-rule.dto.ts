export interface CreateSlaRuleDto {
  name: string;
  channel_type?: string | null;
  category?: string | null;
  priority?: string | null;
  first_response_minutes: number;
  resolution_minutes: number;
  business_hours_only?: boolean;
  is_active?: boolean;
}

export interface UpdateSlaRuleDto {
  name?: string;
  channel_type?: string | null;
  category?: string | null;
  priority?: string | null;
  first_response_minutes?: number;
  resolution_minutes?: number;
  business_hours_only?: boolean;
  is_active?: boolean;
}
