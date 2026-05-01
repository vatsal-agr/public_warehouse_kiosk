"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { supabase } from "@/lib/supabase";

type VenueRow = { id: string; name: string };

function todayYmdLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isPlainRow(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function findClosingBalanceKey(row: Record<string, unknown>): string | null {
  for (const k of Object.keys(row)) {
    if (k.toLowerCase() === "closing_balance") return k;
  }
  return null;
}

/** Resolve actual row key from preferred aliases (first match wins). */
function findKeyByAliases(row: Record<string, unknown>, aliases: string[]): string | null {
  const lowerToActual = new Map<string, string>();
  for (const k of Object.keys(row)) {
    lowerToActual.set(k.toLowerCase(), k);
  }
  for (const a of aliases) {
    const actual = lowerToActual.get(a.toLowerCase());
    if (actual) return actual;
  }
  return null;
}

function buildOrderedColumns(
  row: Record<string, unknown>,
  closingKey: string | null,
): string[] {
  const keySet = new Set(Object.keys(row));
  const productKey = findKeyByAliases(row, [
    "product_name",
    "productname",
    "item_name",
    "name",
  ]);
  const categoryKey = findKeyByAliases(row, ["category", "category_name", "product_category"]);

  const ordered: string[] = [];
  const used = new Set<string>();

  if (productKey && keySet.has(productKey)) {
    ordered.push(productKey);
    used.add(productKey);
  }
  if (categoryKey && keySet.has(categoryKey) && !used.has(categoryKey)) {
    ordered.push(categoryKey);
    used.add(categoryKey);
  }
  if (closingKey && keySet.has(closingKey) && !used.has(closingKey)) {
    ordered.push(closingKey);
    used.add(closingKey);
  }

  const rest = [...keySet]
    .filter((k) => !used.has(k))
    .sort((a, b) => a.localeCompare(b));
  return [...ordered, ...rest];
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function VenueSnapshot() {
  const defaultDate = useMemo(() => todayYmdLocal(), []);

  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [venuesLoading, setVenuesLoading] = useState(true);
  const [venuesError, setVenuesError] = useState<string | null>(null);

  const [venueId, setVenueId] = useState("");
  const [asOnDate, setAsOnDate] = useState(defaultDate);

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** True only after a successful RPC (including empty result). */
  const [auditLoaded, setAuditLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadVenues() {
      setVenuesLoading(true);
      setVenuesError(null);
      const { data, error } = await supabase.from("venues").select("id,name").order("name");

      if (cancelled) return;
      if (error) {
        setVenuesError(error.message);
        setVenues([]);
      } else {
        setVenues((data ?? []) as VenueRow[]);
      }
      setVenuesLoading(false);
    }

    void loadVenues();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadStock = useCallback(async () => {
    if (!venueId.trim()) {
      setErrorMsg("Select a venue.");
      setRows([]);
      setAuditLoaded(false);
      return;
    }
    if (!asOnDate.trim()) {
      setErrorMsg("Choose a date.");
      setRows([]);
      setAuditLoaded(false);
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    const { data, error } = await supabase.rpc("get_venue_stock_as_on_date", {
      p_venue_id: venueId,
      p_date: asOnDate,
    });

    if (error) {
      setErrorMsg(error.message);
      setRows([]);
      setAuditLoaded(false);
      setLoading(false);
      return;
    }

    const raw = Array.isArray(data) ? data : [];
    const parsed: Record<string, unknown>[] = [];
    for (const item of raw) {
      if (isPlainRow(item)) parsed.push(item);
    }
    setRows(parsed);
    setAuditLoaded(true);
    setLoading(false);
  }, [venueId, asOnDate]);

  const closingKey = useMemo(() => {
    if (rows.length === 0) return null;
    return findClosingBalanceKey(rows[0]);
  }, [rows]);

  const columns = useMemo(() => {
    if (rows.length === 0) return [] as string[];
    return buildOrderedColumns(rows[0], closingKey);
  }, [rows, closingKey]);

  const balanceAtVenue = useCallback(
    (row: Record<string, unknown>): number | null => {
      if (!closingKey) return null;
      const raw = row[closingKey];
      const n = toFiniteNumber(raw);
      if (n === null) return null;
      return -1 * n;
    },
    [closingKey],
  );

  const headerLabel = (col: string): string => {
    if (closingKey && col === closingKey) return "Balance";
    const lk = col.toLowerCase();
    if (lk === "product_name") return "Product name";
    if (lk === "category" || lk === "category_name" || lk === "product_category") return "Category";
    return col.replace(/_/g, " ");
  };

  const isNumericBalanceColumn = (col: string) => closingKey !== null && col === closingKey;

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
      <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">Venue Inventory Balance</div>

      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-[200px] flex-1">
          <label htmlFor="as-on-venue" className="block text-xs font-bold uppercase tracking-[0.14em] text-white/45">
            Venue
          </label>
          <select
            id="as-on-venue"
            value={venueId}
            onChange={(e) => {
              setVenueId(e.target.value);
              setRows([]);
              setAuditLoaded(false);
              setErrorMsg(null);
            }}
            disabled={venuesLoading}
            className="mt-2 min-h-[48px] w-full rounded-2xl border border-white/15 bg-black/35 px-3 text-sm font-bold text-white outline-none focus-visible:border-white/30 focus-visible:ring-4 focus-visible:ring-white/25 disabled:opacity-50"
          >
            <option value="">{venuesLoading ? "Loading venues…" : "Select venue"}</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[180px]">
          <label htmlFor="as-on-date" className="block text-xs font-bold uppercase tracking-[0.14em] text-white/45">
            As on date
          </label>
          <input
            id="as-on-date"
            type="date"
            value={asOnDate}
            onChange={(e) => {
              setAsOnDate(e.target.value);
              setRows([]);
              setAuditLoaded(false);
              setErrorMsg(null);
            }}
            className="mt-2 min-h-[48px] w-full rounded-2xl border border-white/15 bg-black/35 px-3 text-sm font-bold text-white outline-none focus-visible:border-white/30 focus-visible:ring-4 focus-visible:ring-white/25"
          />
        </div>

        <button
          type="button"
          onClick={() => void loadStock()}
          disabled={loading || venuesLoading || !venueId}
          className="min-h-[48px] shrink-0 rounded-2xl border-2 border-white/20 bg-[#2E5BFF] px-6 text-xs font-black uppercase tracking-[0.12em] text-white transition hover:bg-[#3A6DFF] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {loading ? "Loading…" : "Load balance"}
        </button>
      </div>

      {venuesError ? (
        <p className="mt-4 text-xs font-bold text-red-300/90">{venuesError}</p>
      ) : null}

      {errorMsg ? (
        <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
          {errorMsg}
        </div>
      ) : null}

      {!loading && auditLoaded && rows.length === 0 && venueId && !errorMsg ? (
        <p className="mt-6 text-sm text-white/55">
          No items recorded at this venue for the selected date.
        </p>
      ) : null}

      {!loading && columns.length > 0 ? (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[480px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-black/30">
                {columns.map((col) => (
                  <th
                    key={col}
                    className="px-3 py-3 text-xs font-black uppercase tracking-[0.12em] text-white/55"
                  >
                    {headerLabel(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const bal = balanceAtVenue(row);
                return (
                  <tr key={i} className="border-b border-white/[0.06] odd:bg-white/[0.02]">
                    {columns.map((col) => (
                      <td
                        key={col}
                        className={
                          isNumericBalanceColumn(col)
                            ? "px-3 py-2.5 font-mono text-[13px] tabular-nums text-white/90"
                            : "px-3 py-2.5 text-[13px] font-bold text-white/90"
                        }
                      >
                        {closingKey && col === closingKey
                          ? bal === null
                            ? "—"
                            : String(bal)
                          : formatCell(row[col])}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
