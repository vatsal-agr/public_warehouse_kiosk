"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, X } from "lucide-react";

import { generateChallanPDF, splitVenueContactInfo } from "@/lib/pdfGenerator";
import { supabase } from "@/lib/supabase";

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

type VenueRow = {
  id: string;
  name: string;
  entity_type?: string;
};

type ProductRow = {
  id: string;
  name: string;
};

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

export default function HistoryPage() {
  const router = useRouter();

  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [venuesLoading, setVenuesLoading] = useState(true);
  const [venuesError, setVenuesError] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState("");
  const [selectedVenueId, setSelectedVenueId] = useState("");

  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<ChallanSummary[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<ChallanSummary | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [items, setItems] = useState<ChallanItem[]>([]);
  const [modalNotes, setModalNotes] = useState<string | null>(null);
  const [modalBillingEntity, setModalBillingEntity] = useState<string | null>(null);
  const [reprintBusy, setReprintBusy] = useState(false);

  const canSearch = !!(selectedDate.trim() || selectedVenueId.trim());

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

    loadVenues();
    return () => {
      cancelled = true;
    };
  }, []);

  const runSearch = useCallback(async () => {
    if (!selectedDate.trim() && !selectedVenueId.trim()) return;

    setSearchLoading(true);
    setSearchError(null);
    setHasSearched(true);

    let query = supabase
      .from("movements")
      .select("challan_number,quantity,timestamp,venue_id,created_by")
      .order("timestamp", { ascending: false });

    if (selectedDate.trim()) {
      const fromISO = startOfLocalDayISO(selectedDate.trim());
      const toISO = endOfLocalDayISO(selectedDate.trim());
      query = query.gte("timestamp", fromISO).lte("timestamp", toISO);
    }

    if (selectedVenueId.trim()) {
      query = query.eq("venue_id", selectedVenueId.trim());
    }

    const { data, error } = await query;

    if (error) {
      setSearchError(error.message);
      setSummaries([]);
      setSearchLoading(false);
      return;
    }

    const rows = (data ?? []) as MovementRow[];

    const venueIds = Array.from(new Set(rows.map((r) => r.venue_id))).filter(Boolean);
    const venueMap = new Map<string, string>();
    if (venueIds.length > 0) {
      const { data: venuesData } = await supabase.from("venues").select("id,name").in("id", venueIds);
      (venuesData ?? []).forEach((v: VenueRow) => {
        venueMap.set(String(v.id), String(v.name));
      });
    }

    const grouped = new Map<string, MovementRow[]>();
    rows.forEach((r) => {
      const key = String(r.challan_number);
      if (!key) return;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(r);
    });

    const built: ChallanSummary[] = Array.from(grouped.entries()).map(([challanNumber, grp]) => {
      const challanNo = String(challanNumber);
      const venueId = grp[0]?.venue_id ?? "";
      const venueName = venueMap.get(venueId) ?? venueId;
      const time = grp.reduce(
        (latest, cur) => (cur.timestamp > latest ? cur.timestamp : latest),
        grp[0]?.timestamp ?? "",
      );
      return {
        challanNumber: challanNo,
        venueId,
        venueName,
        time,
        type: getChallanType(grp),
        createdBy: createdByFromLatestRow(grp),
      };
    });

    setSummaries(built.sort((a, b) => (a.time < b.time ? 1 : -1)));
    setSearchLoading(false);
  }, [selectedDate, selectedVenueId]);

  async function openChallanModal(challan: ChallanSummary) {
    setSelected(challan);
    setItems([]);
    setModalNotes(null);
    setModalBillingEntity(null);
    setItemsLoading(true);
    setModalOpen(true);

    const { data, error } = await supabase
      .from("movements")
      .select("product_id,quantity,notes,billing_entity,created_by")
      .eq("challan_number", challan.challanNumber);

    if (error) {
      setItems([]);
      setItemsLoading(false);
      return;
    }

    const rows = (data ?? []) as {
      product_id: string;
      quantity: number;
      notes: string | null;
      billing_entity: string | null;
      created_by?: string | null;
    }[];
    const productIds = Array.from(new Set(rows.map((r) => r.product_id))).filter(Boolean);

    const productMap = new Map<string, string>();
    if (productIds.length > 0) {
      const { data: productsData } = await supabase
        .from("products")
        .select("id,name")
        .in("id", productIds);
      (productsData ?? []).forEach((p: ProductRow) => {
        productMap.set(String(p.id), String(p.name));
      });
    }

    const built: ChallanItem[] = rows.map((r) => ({
      productId: r.product_id,
      productName: productMap.get(String(r.product_id)) ?? String(r.product_id),
      quantity: r.quantity,
    }));

    const noteRow = rows.find((r) => r.notes != null && String(r.notes).trim() !== "");
    setModalNotes(noteRow?.notes != null ? String(noteRow.notes).trim() : null);

    const billRow = rows.find(
      (r) => r.billing_entity != null && String(r.billing_entity).trim() !== "",
    );
    setModalBillingEntity(
      billRow?.billing_entity != null ? String(billRow.billing_entity).trim() : null,
    );

    setItems(built);
    setItemsLoading(false);
  }

  const formattedDateTime = useMemo(() => {
    if (!selected?.time) return "";
    const d = new Date(selected.time);
    if (Number.isNaN(d.getTime())) return selected.time;
    return d.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [selected?.time]);

  const inputClass =
    "min-h-[52px] w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base text-white outline-none focus-visible:border-white/25 focus-visible:ring-4 focus-visible:ring-white/80";

  return (
    <div className="flex min-h-screen w-full flex-col bg-[#07090B] text-[#F2F5F7]">
      <header className="flex items-center gap-4 border-b border-white/10 px-6 py-5">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="min-h-[48px] min-w-[48px] rounded-2xl border border-white/15 bg-transparent px-3 py-2 text-white/80 transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
          aria-label="Back to home"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-sm font-black uppercase tracking-[0.16em] text-white/90">
            Historical challans
          </h1>
          <p className="mt-1 text-xs text-white/55">Search by date and/or venue</p>
        </div>
      </header>

      <main className="flex flex-1 flex-col px-6 pb-10 pt-6">
        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
            <div className="flex flex-col gap-2">
              <label htmlFor="history-date" className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">
                Date
              </label>
              <input
                id="history-date"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className={`${inputClass} [color-scheme:dark]`}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="history-venue" className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">
                Venue
              </label>
              <select
                id="history-venue"
                value={selectedVenueId}
                onChange={(e) => setSelectedVenueId(e.target.value)}
                disabled={venuesLoading}
                className={`${inputClass} appearance-none bg-[length:1rem] bg-[right_1rem_center] bg-no-repeat pr-10 disabled:opacity-50`}
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23a8b0ba' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                }}
              >
                <option value="">— Select venue —</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id} className="bg-[#0B0E12] text-white">
                    {v.name}
                  </option>
                ))}
              </select>
              {venuesError ? (
                <p className="text-xs font-bold text-red-200/90">{venuesError}</p>
              ) : null}
            </div>

            <div className="flex lg:pb-0">
              <button
                type="button"
                onClick={() => void runSearch()}
                disabled={!canSearch || searchLoading}
                className="min-h-[52px] w-full rounded-2xl border-2 border-[#2E5BFF]/50 bg-[#2E5BFF] px-8 text-center text-sm font-black tracking-[0.1em] text-white shadow-[0_12px_40px_rgba(46,91,255,0.35)] transition hover:bg-[#3A6DFF] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/10 disabled:text-white/40 disabled:shadow-none lg:w-auto lg:min-w-[200px]"
              >
                {searchLoading ? "Searching…" : "🔍 Search"}
              </button>
            </div>
          </div>
          {!canSearch ? (
            <p className="mt-4 text-xs text-white/45">Choose a date and/or a venue to search.</p>
          ) : null}
        </section>

        <div className="mt-8 flex-1">
          {searchError ? (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-xs font-bold text-red-200">
              {searchError}
            </div>
          ) : null}

          {searchLoading ? (
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/60">Loading results…</div>
          ) : hasSearched && !searchError ? (
            summaries.length === 0 ? (
              <div className="text-xs leading-5 text-white/60">No challans matched your search.</div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {summaries.map((c) => (
                  <button
                    key={c.challanNumber}
                    type="button"
                    onClick={() => void openChallanModal(c)}
                    className="min-h-[112px] w-full rounded-3xl border border-white/10 bg-white/5 p-4 text-left transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                    aria-label={`View challan ${c.challanNumber}`}
                  >
                    <div className="text-xs uppercase tracking-[0.2em] text-white/55">Challan</div>
                    <div className="mt-1 truncate text-base font-black text-white/95">{c.challanNumber}</div>
                    <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-white/55">
                      <span>
                        <span className="text-white/45">When: </span>
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
                    <div className="mt-2 text-xs text-white/55">
                      <span className="text-white/45">Venue: </span>
                      <span className="font-bold text-white/85">{c.venueName}</span>
                    </div>
                    <div
                      className={[
                        "mt-3 inline-flex rounded-full px-3 py-1 text-[0.65rem] font-black uppercase tracking-[0.2em]",
                        c.type === "IN"
                          ? "bg-green-500/15 text-green-300"
                          : c.type === "OUT"
                            ? "bg-yellow-500/15 text-yellow-200"
                            : "bg-white/10 text-white/80",
                      ].join(" ")}
                    >
                      {c.type === "IN" ? "Stock in" : c.type === "OUT" ? "Stock out" : "Mixed"}
                    </div>
                  </button>
                ))}
              </div>
            )
          ) : !hasSearched ? (
            <div className="text-xs leading-5 text-white/50">Run a search to see historical challans.</div>
          ) : null}
        </div>
      </main>

      {modalOpen && selected ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Challan details"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="absolute inset-0" onClick={() => setModalOpen(false)} aria-hidden />

          <div className="relative z-10 w-full max-w-[720px] rounded-3xl border border-white/15 bg-[#0B0E12] p-4 shadow-[0_40px_120px_rgba(0,0,0,0.75)]">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.22em] text-white/60">Challan</div>
                <div className="mt-2 text-lg font-black text-white/90">{selected.challanNumber}</div>
                <div className="mt-1 text-xs text-white/60">
                  Venue: <span className="font-bold text-white/85">{selected.venueName}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-white/60">
                  <span>
                    Date / time: <span className="font-bold text-white/85">{formattedDateTime}</span>
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
                onClick={() => setModalOpen(false)}
                className="min-h-[48px] min-w-[48px] rounded-2xl border border-white/10 bg-white/5 p-3 text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 max-h-[45vh] overflow-auto rounded-2xl border border-white/10 bg-white/5 p-3">
              {itemsLoading ? (
                <div className="p-6 text-center text-xs font-bold uppercase tracking-[0.2em] text-white/60">
                  Loading items…
                </div>
              ) : items.length === 0 ? (
                <div className="p-6 text-center text-xs leading-5 text-white/60">No line items for this challan.</div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {items.map((it, idx) => (
                    <li
                      key={`${it.productId}-${idx}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-white/90">{it.productName}</div>
                        <div className="mt-1 text-xs text-white/55">
                          {it.quantity > 0 ? "IN" : it.quantity < 0 ? "OUT" : "—"}
                        </div>
                      </div>
                      <div className="shrink-0 text-sm font-black tabular-nums text-white/90">{it.quantity}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-4">
              <button
                type="button"
                disabled={reprintBusy || itemsLoading}
                onClick={() => {
                  void (async () => {
                    setReprintBusy(true);
                    try {
                      const d = new Date(selected.time);
                      const hasValidTime = !Number.isNaN(d.getTime());
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
                      generateChallanPDF(
                        {
                          challan_number: selected.challanNumber,
                          date: hasValidTime
                            ? d.toLocaleDateString(undefined, {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              })
                            : selected.time,
                          time: hasValidTime
                            ? d.toLocaleTimeString(undefined, {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—",
                          transaction_type: selected.type,
                          notes: modalNotes,
                          client_phone,
                          client_address,
                        },
                        items.map((it) => ({
                          name: it.productName,
                          quantity: it.quantity,
                        })),
                        selected.venueName,
                        modalBillingEntity,
                      );
                    } finally {
                      setReprintBusy(false);
                    }
                  })();
                }}
                className="min-h-[64px] w-full rounded-3xl border-2 border-white/20 bg-white/5 px-4 text-center text-sm font-black tracking-[0.08em] text-white/90 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Reprint receipt"
              >
                🖨️ REPRINT
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
