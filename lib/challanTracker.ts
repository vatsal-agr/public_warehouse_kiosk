/**
 * Supabase table `challan_tracker` (create if missing):
 *
 * create table public.challan_tracker (
 *   challan_number text primary key,
 *   date_key text not null,
 *   suffix integer not null,
 *   status text not null default 'active' check (status in ('active', 'cancelled')),
 *   created_at timestamptz default now()
 * );
 * create index challan_tracker_date_key_idx on public.challan_tracker (date_key);
 *
 * After creating the table, backfill from existing delivery-style movement challan numbers
 * (YYYYMMDD-NN) so the sequence stays contiguous with history, e.g. run a one-off SQL script
 * that inserts one row per distinct challan_number matching ^\\d{8}-\\d+$.
 */

export type ChallanTrackerStatus = "active" | "cancelled";

export function parseDeliveryChallanParts(
  challanNumber: string,
): { dateKey: string; suffix: number } | null {
  const trimmed = challanNumber.trim();
  const m = trimmed.match(/^(\d{8})-(\d+)$/);
  if (!m) return null;
  const suffix = Number.parseInt(m[2], 10);
  if (!Number.isFinite(suffix) || suffix < 1) return null;
  return { dateKey: m[1], suffix };
}

export function todayDateKeyLocal(): string {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const da = String(now.getDate()).padStart(2, "0");
  return `${y}${mo}${da}`;
}
