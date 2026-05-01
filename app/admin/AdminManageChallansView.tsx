"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import { generateChallanPDF, splitVenueContactInfo } from "@/lib/pdfGenerator";
import { supabase } from "@/lib/supabase";
import { useWarehouseStore } from "@/lib/store";

type MovementRow = {
  challan_number: string;
  quantity: number;
  timestamp: string;
  venue_id: string;
  created_by?: string | null;
};

type ChallanSummary = {
  challanNumber: string;
  venueId: string;
  venueName: string;
  time: string;
  type: "IN" | "OUT" | "MIXED";
  createdBy: string | null;
};

type ChallanItem = {
  productId: string;
  productName: string;
  quantity: number;
};

type VenueRow = { id: string; name: string; entity_type?: string };
type ProductRow = { id: string; name: string };

function startOfLocalDayISO(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return new Date(0).toISOString();
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

function endOfLocalDayISO(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return new Date(0).toISOString();
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

function getChallanType(rows: MovementRow[]): "IN" | "OUT" | "MIXED" {
  if (rows.length === 0) return "MIXED";
  const allIn = rows.every((r) => r.quantity > 0);
  const allOut = rows.every((r) => r.quantity < 0);
  if (allIn) return "IN";
  if (allOut) return "OUT";
  return "MIXED";
}

function createdByFromLatestRow(grp: MovementRow[]): string | null {
  if (grp.length === 0) return null;
  const latest = grp.reduce((best, cur) => (cur.timestamp > best.timestamp ? cur : best), grp[0]);
  const raw = latest?.created_by;
  return raw != null && String(raw).trim() !== "" ? String(raw).trim() : null;
}

function defaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  const toYmd = (d: Date) => d.toISOString().slice(0, 10);
  return { start: toYmd(start), end: toYmd(end) };
}

export function AdminManageChallansView() {
  const router = useRouter();
  const defaults = useMemo(() => defaultDateRange(), []);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<ChallanSummary[]>([]);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<ChallanSummary | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [items, setItems] = useState<ChallanItem[]>([]);
  const [modalNotes, setModalNotes] = useState<string | null>(null);
  const [modalBillingEntity, setModalBillingEntity] = useState<string | null>(null);
  const [reprintBusy, setReprintBusy] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<ChallanSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [venuesLoading, setVenuesLoading] = useState(true);
  const [venuesError, setVenuesError] = useState<string | null>(null);
  const [selectedVenueId, setSelectedVenueId] = useState("");

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

  const runSearch = useCallback(async () => {
    if (!startDate.trim() || !endDate.trim()) {
      setErrorMsg("Choose both a start date and an end date.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    const fromISO = startOfLocalDayISO(startDate.trim());
    const toISO = endOfLocalDayISO(endDate.trim());

    let query = supabase
      .from("movements")
      .select("challan_number,quantity,timestamp,venue_id,created_by")
      .gte("timestamp", fromISO)
      .lte("timestamp", toISO)
      .order("timestamp", { ascending: false });

    if (selectedVenueId.trim()) {
      query = query.eq("venue_id", selectedVenueId.trim());
    }

    const { data, error } = await query;

    if (error) {
      setErrorMsg(error.message);
      setSummaries([]);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as MovementRow[];

    const venueIds = [...new Set(rows.map((r) => r.venue_id))].filter(Boolean);
    const venueMap = new Map<string, string>();
    if (venueIds.length > 0) {
      const { data: venuesData } = await supabase.from("venues").select("id,name").in("id", venueIds);
      (venuesData ?? []).forEach((v: VenueRow) => venueMap.set(String(v.id), String(v.name)));
    }

    const grouped = new Map<string, MovementRow[]>();
    rows.forEach((r) => {
      const key = String(r.challan_number);
      if (!key) return;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(r);
    });

    const built: ChallanSummary[] = [...grouped.entries()].map(([challanNumber, grp]) => {
      const venueId = grp[0]?.venue_id ?? "";
      const venueName = venueMap.get(venueId) ?? venueId;
      const time = grp.reduce(
        (latest, cur) => (cur.timestamp > latest ? cur.timestamp : latest),
        grp[0]?.timestamp ?? "",
      );
      return {
        challanNumber: String(challanNumber),
        venueId,
        venueName,
        time,
        type: getChallanType(grp),
        createdBy: createdByFromLatestRow(grp),
      };
    });

    setSummaries(built.sort((a, b) => (a.time < b.time ? 1 : -1)));
    setLoading(false);
  }, [startDate, endDate, selectedVenueId]);

  useEffect(() => {
    void runSearch();
    // Initial load + explicit "Apply range" only (not on every keystroke).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount with default dates
  }, []);

  async function openDetail(challan: ChallanSummary) {
    setSelected(challan);
    setItems([]);
    setModalNotes(null);
    setModalBillingEntity(null);
    setEditError(null);
    setItemsLoading(true);
    setDetailOpen(true);

    const { data, error } = await supabase
      .from("movements")
      .select("product_id,quantity,notes,billing_entity,created_by")
      .eq("challan_number", challan.challanNumber);

    if (error) {
      setItems([]);
      setItemsLoading(false);
      return;
    }

    const movRows = (data ?? []) as {
      product_id: string;
      quantity: number;
      notes: string | null;
      billing_entity: string | null;
      created_by?: string | null;
    }[];
    const productIds = [...new Set(movRows.map((r) => r.product_id))].filter(Boolean);

    const productMap = new Map<string, string>();
    if (productIds.length > 0) {
      const { data: productsData } = await supabase
        .from("products")
        .select("id,name")
        .in("id", productIds);
      (productsData ?? []).forEach((p: ProductRow) => productMap.set(String(p.id), String(p.name)));
    }

    const built: ChallanItem[] = movRows.map((r) => ({
      productId: r.product_id,
      productName: productMap.get(String(r.product_id)) ?? String(r.product_id),
      quantity: r.quantity,
    }));

    const noteRow = movRows.find((r) => r.notes != null && String(r.notes).trim() !== "");
    setModalNotes(noteRow?.notes != null ? String(noteRow.notes).trim() : null);

    const billRow = movRows.find(
      (r) => r.billing_entity != null && String(r.billing_entity).trim() !== "",
    );
    setModalBillingEntity(
      billRow?.billing_entity != null ? String(billRow.billing_entity).trim() : null,
    );

    setItems(built);
    setItemsLoading(false);
  }

  async function reprintPdf() {
    if (!selected) return;
    const challanNo = selected.challanNumber?.trim();
    if (!challanNo) return;

    const venueName =
      selected.venueName?.trim() ||
      selected.venueId?.trim() ||
      "—";

    const txType =
      selected.type === "IN" || selected.type === "OUT" || selected.type === "MIXED"
        ? selected.type
        : "MIXED";

    const d = selected.time ? new Date(selected.time) : null;
    const hasValidTime = d != null && !Number.isNaN(d.getTime());
    const dateStr = hasValidTime
      ? d!.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : selected.time || "—";
    const timeStr = hasValidTime
      ? d!.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : "—";

    let client_phone: string | null = null;
    let client_address: string | null = null;
    const vid = selected.venueId?.trim();
    if (vid) {
      const { data: vRow } = await supabase
        .from("venues")
        .select("contact_info")
        .eq("id", vid)
        .maybeSingle();
      const split = splitVenueContactInfo(
        (vRow as { contact_info?: string | null } | null)?.contact_info,
      );
      client_phone = split.phone || null;
      client_address = split.address || null;
    }

    setReprintBusy(true);
    try {
      generateChallanPDF(
        {
          challan_number: challanNo,
          date: dateStr,
          time: timeStr,
          transaction_type: txType,
          notes: modalNotes ?? undefined,
          client_phone,
          client_address,
        },
        (items ?? []).map((it) => ({
          name: it.productName?.trim() || "Item",
          quantity: typeof it.quantity === "number" && Number.isFinite(it.quantity) ? it.quantity : 0,
        })),
        venueName,
        modalBillingEntity,
      );
    } catch {
      /* ignore */
    } finally {
      setReprintBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);

    const { error } = await supabase
      .from("movements")
      .delete()
      .eq("challan_number", deleteTarget.challanNumber);

    if (error) {
      setDeleteError(error.message);
      setDeleteBusy(false);
      return;
    }

    setDeleteTarget(null);
    setDeleteBusy(false);
    if (selected?.challanNumber === deleteTarget.challanNumber) {
      setDetailOpen(false);
      setSelected(null);
    }
    await runSearch();
  }

  const inputClass =
    "min-h-[48px] w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base text-white outline-none focus-visible:border-white/25 focus-visible:ring-4 focus-visible:ring-white/80 [color-scheme:dark]";

  const selectClass = `${inputClass} appearance-none bg-[length:1rem] bg-[right_1rem_center] bg-no-repeat pr-10 disabled:opacity-50`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 xl:items-end">
          <div className="flex flex-col gap-2">
            <label htmlFor="admin-challan-start" className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">
              Start date
            </label>
            <input
              id="admin-challan-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="admin-challan-end" className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">
              End date
            </label>
            <input
              id="admin-challan-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-2 xl:col-span-1">
            <label htmlFor="admin-challan-venue" className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">
              Venue
            </label>
            <select
              id="admin-challan-venue"
              value={selectedVenueId}
              onChange={(e) => setSelectedVenueId(e.target.value)}
              disabled={venuesLoading}
              className={selectClass}
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23a8b0ba' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
              }}
            >
              <option value="">All venues</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id} className="bg-[#0B0E12] text-white">
                  {v.name}
                </option>
              ))}
            </select>
            {venuesError ? (
              <p className="text-xs font-bold text-red-300/90">{venuesError}</p>
            ) : null}
          </div>
          <div className="flex items-end xl:justify-end">
            <button
              type="button"
              onClick={() => void runSearch()}
              disabled={loading}
              className="min-h-[48px] w-full rounded-2xl border-2 border-[#2E5BFF]/50 bg-[#2E5BFF] px-8 text-sm font-black uppercase tracking-[0.1em] text-white transition hover:bg-[#3A6DFF] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 disabled:opacity-50 xl:w-auto"
            >
              {loading ? "Loading…" : "Apply filters"}
            </button>
          </div>
        </div>
      </div>

      {errorMsg ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm font-bold text-red-200">
          {errorMsg}
        </div>
      ) : null}

      {loading ? (
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/55">Loading challans…</div>
      ) : summaries.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-sm text-white/55">
          {selectedVenueId.trim()
            ? "No challans match this venue and date range."
            : "No challans in this date range."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {summaries.map((c) => (
            <div
              key={c.challanNumber}
              className="rounded-3xl border border-white/10 bg-white/[0.04] p-4"
            >
              <div className="text-xs uppercase tracking-[0.2em] text-white/50">Challan</div>
              <div className="mt-1 font-black text-white/95">{c.challanNumber}</div>
              <div className="mt-2 text-xs text-white/55">
                <span className="text-white/40">Venue: </span>
                <span className="font-bold text-white/85">{c.venueName}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-white/55">
                <span>
                  <span className="text-white/40">When: </span>
                  <span className="font-bold text-white/85">
                    {(() => {
                      const d = new Date(c.time);
                      return Number.isNaN(d.getTime())
                        ? c.time
                        : d.toLocaleString([], {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          });
                    })()}
                  </span>
                </span>
                <span className="text-[0.65rem] font-medium text-white/40">
                  👤 Generated by: {c.createdBy ?? "Unknown"}
                </span>
              </div>
              <div
                className={[
                  "mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[0.65rem] font-black uppercase tracking-[0.18em]",
                  c.type === "IN"
                    ? "bg-green-500/15 text-green-300"
                    : c.type === "OUT"
                      ? "bg-yellow-500/15 text-yellow-200"
                      : "bg-white/10 text-white/75",
                ].join(" ")}
              >
                {c.type}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void openDetail(c)}
                  className="min-h-[44px] flex-1 rounded-2xl border border-white/15 bg-white/10 px-4 text-xs font-black uppercase tracking-[0.1em] text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                >
                  View / Reprint
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteTarget(c);
                  }}
                  className="min-h-[44px] shrink-0 rounded-2xl border border-red-500/40 bg-red-500/15 px-4 text-xs font-black uppercase tracking-[0.1em] text-red-200 transition hover:bg-red-500/25 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-300/50"
                >
                  🗑️ DELETE
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {detailOpen && selected ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Challan details"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="absolute inset-0" onClick={() => setDetailOpen(false)} aria-hidden />

          <div className="relative z-10 w-full max-w-[720px] rounded-3xl border border-white/15 bg-[#0B0E12] p-4 shadow-[0_40px_120px_rgba(0,0,0,0.75)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-white/60">Challan</div>
                <div className="mt-2 text-lg font-black text-white/90">{selected.challanNumber}</div>
                <div className="mt-1 text-xs text-white/60">
                  Venue: <span className="font-bold text-white/85">{selected.venueName}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-white/60">
                  <span>
                    When:{" "}
                    <span className="font-bold text-white/85">
                      {(() => {
                        const d = new Date(selected.time);
                        return Number.isNaN(d.getTime())
                          ? selected.time
                          : d.toLocaleString([], {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            });
                      })()}
                    </span>
                  </span>
                  <span className="text-[0.65rem] font-medium text-white/40">
                    👤 Generated by: {selected.createdBy ?? "Unknown"}
                  </span>
                </div>
                <div className="mt-2 text-xs font-bold uppercase tracking-[0.2em] text-white/70">
                  Type: <span className="text-white/90">{selected.type}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailOpen(false)}
                className="min-h-[48px] min-w-[48px] rounded-2xl border border-white/10 bg-white/5 p-3 text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 max-h-[40vh] overflow-auto rounded-2xl border border-white/10 bg-white/5 p-3">
              {itemsLoading ? (
                <div className="p-6 text-center text-xs font-bold text-white/55">Loading lines…</div>
              ) : items.length === 0 ? (
                <div className="p-6 text-center text-xs text-white/55">No line items.</div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {items.map((it, idx) => (
                    <li
                      key={`${it.productId}-${idx}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3"
                    >
                      <span className="min-w-0 truncate text-sm font-bold text-white/90">{it.productName}</span>
                      <span className="font-mono text-sm font-black text-white/90">{it.quantity}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {editError ? (
              <p className="mt-3 text-xs font-bold text-red-300" role="alert">
                {editError}
              </p>
            ) : null}

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={reprintBusy || itemsLoading || editBusy}
                onClick={() => reprintPdf()}
                className="min-h-[56px] w-full rounded-2xl border-2 border-white/20 bg-white/5 text-sm font-black tracking-[0.08em] text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 disabled:opacity-50"
              >
                🖨️ Reprint PDF
              </button>
              <button
                type="button"
                disabled={reprintBusy || itemsLoading || editBusy}
                onClick={async () => {
                  if (!selected) return;
                  setEditError(null);
                  setEditBusy(true);
                  const res = await useWarehouseStore.getState().prepareEditChallanForPicker(
                    selected.challanNumber,
                    selected.type,
                  );
                  setEditBusy(false);
                  if (!res.ok) {
                    setEditError(res.error);
                    return;
                  }
                  setDetailOpen(false);
                  const challan = encodeURIComponent(selected.challanNumber);
                  const venueId = encodeURIComponent(selected.venueId);
                  router.push(
                    `/picker?mode=${res.mode}&edit=${challan}&venue_id=${venueId}`,
                  );
                }}
                className="min-h-[56px] w-full rounded-2xl border-2 border-white/20 bg-white/5 text-sm font-black tracking-[0.08em] text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 disabled:opacity-50"
              >
                {editBusy ? "…" : "✏️ Edit challan"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-challan-title"
          aria-describedby="delete-challan-desc"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
        >
          <div className="absolute inset-0" onClick={() => !deleteBusy && setDeleteTarget(null)} aria-hidden />

          <div className="relative z-10 w-full max-w-[440px] rounded-3xl border-2 border-red-500/50 bg-[#140808] p-6 shadow-[0_40px_120px_rgba(0,0,0,0.85)]">
            <h2 id="delete-challan-title" className="text-lg font-black uppercase tracking-[0.12em] text-red-200">
              Delete challan?
            </h2>
            <p id="delete-challan-desc" className="mt-4 text-sm leading-6 text-red-100/90">
              <span className="font-black text-red-200">WARNING:</span> This will permanently erase this challan
              and alter current inventory levels. Proceed?
            </p>
            <p className="mt-2 font-mono text-xs text-white/50">{deleteTarget.challanNumber}</p>

            {deleteError ? (
              <p className="mt-3 text-xs font-bold text-red-300">{deleteError}</p>
            ) : null}

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => setDeleteTarget(null)}
                className="min-h-[52px] rounded-2xl border border-white/15 bg-white/5 text-sm font-black text-white/85 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => void confirmDelete()}
                className="min-h-[52px] rounded-2xl border-2 border-red-400 bg-red-600 text-sm font-black text-white transition hover:bg-red-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-300/60 disabled:opacity-50"
              >
                {deleteBusy ? "Deleting…" : "Yes, delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
