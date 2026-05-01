/**
 * Normalizes get_sequential_movements RPC rows into a product × movement matrix.
 * Adjust field lists if your DB uses different column names.
 */
export type RawRpcRow = Record<string, unknown>;
export type MovementTone = "in" | "out" | "neutral";

const CHALLAN_KEYS = ["challan_number", "challan", "challan_no"] as const;
const TIME_KEYS = [
  "timestamp",
  "movement_time",
  "created_at",
  "at",
  "date",
  "movement_date",
  "challan_date",
] as const;
const PRODUCT_ID_KEYS = ["product_id", "productid"] as const;
const PRODUCT_NAME_KEYS = ["product_name", "item_name", "product", "name"] as const;
const QTY_KEYS = ["quantity", "qty", "q", "signed_quantity"] as const;

function pickString(row: RawRpcRow, keys: readonly string[]): string | null {
  for (const k of keys) {
    for (const rk of Object.keys(row)) {
      if (rk.toLowerCase() === k) {
        const v = row[rk];
        if (v == null) continue;
        if (typeof v === "string" && v.trim() !== "") return v.trim();
        if (typeof v === "number" && Number.isFinite(v)) return String(v);
      }
    }
  }
  for (const k of keys) {
    const v = (row as Record<string, unknown>)[k];
    if (v == null) continue;
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

function toMillis(v: unknown): number {
  if (v == null) return 0;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.getTime();
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string" && v.trim() !== "") {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const p = Date.parse(v + "T00:00:00");
      if (Number.isFinite(p)) return p;
    }
  }
  return 0;
}

function toQty(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export function extractChallan(row: RawRpcRow): string | null {
  return pickString(row, CHALLAN_KEYS);
}

export function parseRows(
  raw: unknown[] | null | undefined,
): {
  rawRows: RawRpcRow[];
  movementColumns: {
    id: string;
    sortMs: number;
    challan: string;
    tone: MovementTone;
  }[];
  productOrder: { key: string; name: string }[];
  cellQty: Map<string, Map<string, number>>;
} {
  const list = (raw ?? []).filter(
    (r): r is RawRpcRow => r != null && typeof r === "object" && !Array.isArray(r),
  ) as RawRpcRow[];

  type Agg = { minMs: number; maxMs: number; qSum: number };
  const perChallan = new Map<string, Agg>();
  const cell = new Map<string, Map<string, number>>();
  const productNameByKey = new Map<string, string>();

  for (let idx = 0; idx < list.length; idx++) {
    const row = list[idx];
    let challan = extractChallan(row);
    if (!challan) {
      const t0 = toMillis(
        (TIME_KEYS.map((k) => row[k]).find((x) => x != null) as unknown) ?? 0,
      );
      challan = `__noref_${t0 || idx}__${idx}`;
    }

    const tRaw = TIME_KEYS.map((k) => row[k]).find((x) => x != null);
    const rowMs = toMillis(tRaw);

    const pid = pickString(row, PRODUCT_ID_KEYS) ?? `name:${pickString(row, PRODUCT_NAME_KEYS) ?? "Unknown"}`;
    const pname = pickString(row, PRODUCT_NAME_KEYS) ?? pickString(row, PRODUCT_ID_KEYS) ?? "Unknown product";
    productNameByKey.set(pid, pname);

    const q = toQty(
      (() => {
        for (const k of QTY_KEYS) {
          if (k in row) return (row as Record<string, unknown>)[k];
        }
        for (const k of Object.keys(row)) {
          if (k.toLowerCase() === "quantity" || k.toLowerCase() === "qty")
            return (row as Record<string, unknown>)[k];
        }
        return undefined;
      })(),
    );

    if (!perChallan.has(challan)) {
      perChallan.set(challan, { minMs: rowMs, maxMs: rowMs, qSum: 0 });
    } else {
      const a = perChallan.get(challan)!;
      a.minMs = Math.min(a.minMs, rowMs);
      a.maxMs = Math.max(a.maxMs, rowMs);
    }
    perChallan.get(challan)!.qSum += q;

    if (!cell.has(pid)) cell.set(pid, new Map());
    const m = cell.get(pid)!;
    m.set(challan, (m.get(challan) ?? 0) + q);
  }

  const movementColumns: { id: string; sortMs: number; challan: string; tone: MovementTone }[] = [];

  for (const [ch, agg] of perChallan) {
    const s = agg.qSum;
    const tone: MovementTone =
      s === 0 ? "neutral" : s < 0 ? "out" : "in";
    movementColumns.push({ id: ch, sortMs: agg.minMs, challan: ch, tone });
  }

  movementColumns.sort(
    (a, b) => a.sortMs - b.sortMs || a.challan.localeCompare(b.challan, undefined, { numeric: true }),
  );

  const productOrder = [...cell.keys()]
    .map((key) => ({ key, name: productNameByKey.get(key) ?? key }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  return { rawRows: list, movementColumns, productOrder, cellQty: cell };
}

export function shortDateForHeader(sortMs: number, challan: string, rows: RawRpcRow[]) {
  if (sortMs > 0) {
    try {
      const d = new Date(sortMs);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    } catch {
      /* continue */
    }
  }
  const sample = rows.find((r) => extractChallan(r) === challan);
  if (sample) {
    for (const k of TIME_KEYS) {
      if (k in sample) {
        const ms = toMillis((sample as Record<string, unknown>)[k]);
        if (ms > 0) {
          const d = new Date(ms);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        }
      }
    }
  }
  return "—";
}

function csvEscape(s: string): string {
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCsv(args: {
  productOrder: { key: string; name: string }[];
  movementColumns: { id: string; sortMs: number; challan: string; tone: MovementTone }[];
  cellQty: Map<string, Map<string, number>>;
  colHeaders: { date: string; challan: string }[];
}): string {
  const { productOrder, movementColumns, cellQty, colHeaders } = args;
  const head = [
    "Item name",
    ...colHeaders.map((h) => `${h.date} | ${h.challan}`),
  ]
    .map(csvEscape)
    .join(",");
  const lines: string[] = [head];
  for (const p of productOrder) {
    const row: string[] = [csvEscape(p.name)];
    const m = cellQty.get(p.key);
    for (let c = 0; c < movementColumns.length; c++) {
      const ch = movementColumns[c].id;
      const v = m?.get(ch) ?? 0;
      const cellStr = v === 0 && !m?.has(ch) ? "" : String(v);
      row.push(cellStr);
    }
    lines.push(row.join(","));
  }
  return lines.join("\r\n");
}

function cellToCsvValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** One row per RPC record; column set is the union of keys across rows, sorted. */
export function rawMovementRowsToCsv(rows: unknown[]): string {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const keySet = new Set<string>();
  for (const r of rows) {
    if (r != null && typeof r === "object" && !Array.isArray(r)) {
      for (const k of Object.keys(r as object)) keySet.add(k);
    }
  }
  const keys = [...keySet].sort((a, b) => a.localeCompare(b));
  if (keys.length === 0) return "";
  const header = keys.map(csvEscape).join(",");
  const lineRows = rows
    .filter((r) => r != null && typeof r === "object" && !Array.isArray(r))
    .map((r) => {
      const o = r as Record<string, unknown>;
      return keys.map((k) => csvEscape(cellToCsvValue(o[k]))).join(",");
    });
  return [header, ...lineRows].join("\r\n");
}
