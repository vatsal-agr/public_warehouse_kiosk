"use client";

import { useCallback, useEffect, useMemo, useId, useState } from "react";
import { Download, Loader2, X } from "lucide-react";

import { buildCsv, parseRows, shortDateForHeader } from "@/lib/sequenceLedgerFromRpc";
import { supabase } from "@/lib/supabase";

type VenueRow = { id: string; name: string };

const MIN_PACKAGING_MS = 1000;

function defaultRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  return { start: ymd(start), end: ymd(end) };
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * get_sequential_movements(p_venue_ids, p_start_date, p_end_date) — adjust
 * the rpc() call if your function uses other argument names.
 */
export function SequenceLedgerView() {
  const switchId = useId();
  const hintId = useId();

  const defaults = useMemo(() => defaultRange(), []);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [venuesLoading, setVenuesLoading] = useState(true);
  const [venueError, setVenueError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [packaging, setPackaging] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const canExport = selectedIds.size > 0 && !venuesLoading;
  const allSelected = venues.length > 0 && selectedIds.size === venues.length;

  useEffect(() => {
    let c = false;
    async function loadV() {
      setVenuesLoading(true);
      setVenueError(null);
      const { data, error } = await supabase.from("venues").select("id,name").order("name");
      if (c) return;
      if (error) {
        setVenueError(error.message);
        setVenues([]);
      } else {
        setVenues((data ?? []) as VenueRow[]);
      }
      setVenuesLoading(false);
    }
    void loadV();
    return () => {
      c = true;
    };
  }, []);

  const selectAllVenues = useCallback(() => {
    setSelectedIds(new Set(venues.map((v) => v.id)));
  }, [venues]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const removeVenue = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
  }, []);

  const addVenueId = useCallback((id: string) => {
    if (!id) return;
    setSelectedIds((prev) => new Set(prev).add(id));
  }, []);

  const toggleAllSwitch = useCallback(() => {
    if (allSelected) clearSelection();
    else selectAllVenues();
  }, [allSelected, clearSelection, selectAllVenues]);

  const unselectedVenues = useMemo(
    () => venues.filter((v) => !selectedIds.has(v.id)),
    [venues, selectedIds],
  );

  const selectedList = useMemo(
    () => venues.filter((v) => selectedIds.has(v.id)),
    [venues, selectedIds],
  );

  const generateCsv = useCallback(async () => {
    if (startDate > endDate) {
      setLoadError("Start date must be on or before end date.");
      return;
    }
    const ids = [...selectedIds];
    if (ids.length === 0) return;

    setPackaging(true);
    setLoadError(null);
    const started = performance.now();

    const { data, error } = await supabase.rpc("get_sequential_movements", {
      p_venue_ids: ids,
      p_start_date: startDate,
      p_end_date: endDate,
    });

    if (error) {
      setLoadError(error.message);
      setPackaging(false);
      return;
    }

    if (!Array.isArray(data)) {
      setLoadError("get_sequential_movements must return an array of rows.");
      setPackaging(false);
      return;
    }

    if (data.length === 0) {
      const emptyElapsed = performance.now() - started;
      if (emptyElapsed < MIN_PACKAGING_MS) await sleep(MIN_PACKAGING_MS - emptyElapsed);
      setLoadError("No movements in this range to export (empty result).");
      setPackaging(false);
      return;
    }

    const ledger = parseRows(data);
    const colHeaders = ledger.movementColumns.map((m) => ({
      date: shortDateForHeader(m.sortMs, m.challan, ledger.rawRows),
      challan: m.challan,
    }));
    const csv = buildCsv({
      productOrder: ledger.productOrder,
      movementColumns: ledger.movementColumns,
      cellQty: ledger.cellQty,
      colHeaders,
    });
    const elapsed = performance.now() - started;
    if (elapsed < MIN_PACKAGING_MS) await sleep(MIN_PACKAGING_MS - elapsed);

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sequence-ledger_${startDate}_to_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    setPackaging(false);
  }, [selectedIds, startDate, endDate]);

  return (
    <div>
      <div
        className="relative overflow-hidden rounded-[28px] border border-white/15 bg-gradient-to-br from-white/[0.09] via-white/[0.04] to-transparent p-6 shadow-[0_16px_64px_rgba(0,0,0,0.45)] backdrop-blur-2xl md:p-8"
        style={{ boxShadow: "0 16px 64px rgba(0,0,0,0.45), inset 0 1px 0 0 rgba(255,255,255,0.08)" }}
      >
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_0%_0%,rgba(46,91,255,0.12),transparent)]"
          aria-hidden
        />

        <div className="relative">
          <h2 className="text-sm font-black uppercase tracking-[0.2em] text-white/50">Data Export Center</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/60">
            Select venues and dates to download the raw movement data.
          </p>

          <div className="mt-8 flex flex-col gap-8">
            <div>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="text-xs font-bold uppercase tracking-[0.16em] text-white/50">Venues</span>
                  {venuesLoading ? (
                    <p className="mt-1 text-sm text-white/40">Loading venues…</p>
                  ) : null}
                </div>
                {venues.length > 0 && !venuesLoading ? (
                  <div className="flex items-center gap-3 self-start sm:self-auto">
                    <span id={switchId} className="text-sm font-bold text-white/80">
                      All venues
                    </span>
                    <button
                      type="button"
                      id={`${switchId}-btn`}
                      role="switch"
                      aria-checked={allSelected}
                      aria-labelledby={switchId}
                      onClick={toggleAllSwitch}
                      className={[
                        "flex h-8 w-14 shrink-0 items-center rounded-full p-0.5 transition-[background,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2E5BFF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0c0f]",
                        allSelected
                          ? "bg-[#2E5BFF] shadow-[0_0_20px_rgba(46,91,255,0.35)]"
                          : "bg-zinc-600/90",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "h-7 w-7 rounded-full bg-white shadow-md transition-[margin] duration-200 ease-out",
                          allSelected ? "ml-auto" : "",
                        ].join(" ")}
                        aria-hidden
                      />
                    </button>
                  </div>
                ) : null}
              </div>

              {venueError ? <p className="mt-3 text-sm font-bold text-red-300/90">{venueError}</p> : null}

              <div className="mt-3 flex min-h-[44px] flex-wrap gap-2">
                {selectedList.length === 0 && !venuesLoading && venues.length > 0 ? (
                  <span className="text-sm text-white/40">No venues selected yet.</span>
                ) : null}
                {selectedList.map((v) => (
                  <span
                    key={v.id}
                    className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 pl-3.5 pr-1 py-1 text-sm font-bold text-white/95 shadow-sm backdrop-blur-sm"
                  >
                    <span className="max-w-[200px] truncate sm:max-w-xs">{v.name}</span>
                    <button
                      type="button"
                      onClick={() => removeVenue(v.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-white/70 transition hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                      aria-label={`Remove ${v.name}`}
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </button>
                  </span>
                ))}
              </div>

              {unselectedVenues.length > 0 ? (
                <div className="mt-3">
                  <label htmlFor="export-add-venue" className="sr-only">
                    Add a venue
                  </label>
                  <select
                    id="export-add-venue"
                    className="w-full max-w-md rounded-2xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm font-bold text-white/90 outline-none focus-visible:border-white/30 focus-visible:ring-2 focus-visible:ring-[#2E5BFF]/50 sm:w-auto"
                    value=""
                    onChange={(e) => {
                      addVenueId(e.target.value);
                      e.target.value = "";
                    }}
                  >
                    <option value="">+ Add a venue</option>
                    {unselectedVenues.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>

            <div>
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-white/50">Date range</div>
              <div className="mt-2 flex max-w-2xl flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/12 bg-black/25 px-3 py-1 backdrop-blur-sm">
                  <span className="shrink-0 text-xs font-bold uppercase text-white/40">From</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="min-w-0 flex-1 min-h-[40px] border-0 bg-transparent py-2 text-sm font-bold text-white outline-none"
                  />
                </div>
                <span className="hidden text-white/30 sm:mx-0 sm:block">→</span>
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/12 bg-black/25 px-3 py-1 backdrop-blur-sm">
                  <span className="shrink-0 text-xs font-bold uppercase text-white/40">To</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="min-w-0 flex-1 min-h-[40px] border-0 bg-transparent py-2 text-sm font-bold text-white outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end sm:gap-4">
              <div
                className="relative w-full sm:w-auto"
                title={!canExport && !packaging ? "Please select at least one venue to export." : undefined}
              >
                <div
                  className="flex flex-col gap-1"
                  aria-describedby={!canExport ? hintId : undefined}
                >
                  <button
                    type="button"
                    onClick={() => void generateCsv()}
                    disabled={!canExport || packaging}
                    className="inline-flex min-h-[56px] w-full items-center justify-center gap-3 rounded-2xl border-2 border-white/20 bg-gradient-to-b from-[#3d6aff] to-[#2E5BFF] px-8 text-sm font-black uppercase tracking-[0.14em] text-white shadow-[0_8px_32px_rgba(46,91,255,0.4)] transition hover:from-[#4a74ff] hover:to-[#335dff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0c0f] disabled:cursor-not-allowed disabled:opacity-40 sm:min-w-[240px] sm:justify-center"
                    aria-label="Generate and download movement data as CSV"
                  >
                    {packaging ? (
                      <>
                        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-white" strokeWidth={2.5} />
                        <span>Packaging…</span>
                      </>
                    ) : (
                      <>
                        <Download className="h-5 w-5 shrink-0" strokeWidth={2.5} />
                        <span>Generate CSV</span>
                      </>
                    )}
                  </button>
                  {!canExport && !packaging && venues.length > 0 ? (
                    <p id={hintId} className="text-center text-xs text-amber-200/75 sm:text-left" role="status">
                      Please select at least one venue to export.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {loadError ? (
        <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm font-bold text-red-200">
          {loadError}
        </div>
      ) : null}
    </div>
  );
}
