/**
 * Tipos do subsistema de analytics de Social.
 */

export interface SocialMetricsDaily {
  id: string;
  org_id: string;
  content_id: string;
  brand_id: string | null;
  channel: string;
  external_post_id: string | null;
  date: string;
  reach: number;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  saved: number;
  profile_visits: number;
  profile_follows: number;
  video_views: number;
  total_interactions: number;
  engagement_rate: number;
  raw_metrics: Record<string, unknown>;
  fetched_at: string;
  created_at: string;
  updated_at: string;
}

export type SignalType =
  | 'hit_post'
  | 'flop_post'
  | 'best_time_window'
  | 'best_pillar'
  | 'best_hashtag'
  | 'declining_trend'
  | 'engagement_spike';

export interface SocialSignal {
  id: string;
  org_id: string;
  brand_id: string | null;
  content_id: string | null;
  signal_type: SignalType;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string | null;
  metric_name: string | null;
  metric_value: number | null;
  benchmark_value: number | null;
  delta_pct: number | null;
  dedupe_key: string;
  detected_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  metadata: Record<string, unknown>;
}

export interface ReportSummary {
  posts_with_metrics: number;
  total_reach: number;
  total_impressions: number;
  total_likes: number;
  total_comments: number;
  total_shares: number;
  total_saved: number;
  total_profile_visits: number;
  total_profile_follows: number;
  avg_engagement_rate: number;
}

export interface PillarReportRow {
  pillar: string;
  total_posts: number;
  avg_engagement_rate: number;
  avg_reach: number;
  avg_likes: number;
  total_interactions: number;
}

export interface HourReportRow {
  hour_of_day: number;
  posts_count: number;
  avg_engagement_rate: number;
  avg_reach: number;
}

export interface TopPerformerRow {
  content_id: string;
  title: string | null;
  pillar: string | null;
  content_type: string;
  cover_image_url: string | null;
  total_reach: number;
  total_engagement: number;
  avg_engagement_rate: number;
}
