// ============================================================
// Common shared types
// ============================================================

/** Generic JSON value (matches PostgreSQL jsonb) */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

/** ISO 8601 date-time string (PostgreSQL timestamptz serialized) */
export type ISODateString = string;

/** ISO 8601 date string (YYYY-MM-DD) — PostgreSQL date */
export type ISODateOnly = string;

/** UUID v4 string */
export type UUID = string;
