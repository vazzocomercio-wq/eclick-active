export interface CreateTemplateDto {
  name: string;
  category?: string | null;
  content: string;
  variables?: string[];
  is_active?: boolean;
}

export interface UpdateTemplateDto {
  name?: string;
  category?: string | null;
  content?: string;
  variables?: string[];
  is_active?: boolean;
}
