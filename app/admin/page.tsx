"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { AdminManageChallansView } from "./AdminManageChallansView";
import { StockAtVenuesView } from "./StockAtVenuesView";
import { SequenceLedgerView } from "./SequenceLedgerView";
import { VenueSnapshot } from "./VenueSnapshot";

const ADMIN_PIN = "2026";

type AdminTab = "stock" | "challans" | "history" | "ledger";

export default function AdminPage() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>("stock");

  const submitPin = useCallback(() => {
    if (pin === ADMIN_PIN) {
      setIsAuthenticated(true);
      setPinError(false);
      setPin("");
    } else {
      setPinError(true);
    }
  }, [pin]);

  const onPinKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitPin();
      }
    },
    [submitPin],
  );

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-[#07090B] px-4 text-[#F2F5F7]">
        <div className="w-full max-w-[400px] rounded-3xl border border-white/10 bg-white/[0.06] p-8 shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
          <h1 className="text-center text-lg font-black uppercase tracking-[0.14em] text-white/90">
            Admin login
          </h1>
          <p className="mt-2 text-center text-xs text-white/50">Enter the 4-digit PIN</p>

          <label htmlFor="admin-pin" className="sr-only">
            4-digit PIN
          </label>
          <input
            id="admin-pin"
            type="password"
            inputMode="numeric"
            maxLength={4}
            autoComplete="one-time-code"
            value={pin}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 4);
              setPin(v);
              setPinError(false);
            }}
            onKeyDown={onPinKeyDown}
            className="mt-6 min-h-[56px] w-full rounded-2xl border border-white/15 bg-black/40 px-4 text-center text-2xl font-black tracking-[0.4em] text-white outline-none placeholder:text-white/30 focus-visible:border-white/30 focus-visible:ring-4 focus-visible:ring-white/25"
            placeholder="••••"
            aria-invalid={pinError}
            aria-describedby={pinError ? "pin-error" : undefined}
          />

          {pinError ? (
            <p id="pin-error" className="mt-3 text-center text-sm font-bold text-red-300" role="alert">
              Incorrect PIN
            </p>
          ) : null}

          <button
            type="button"
            onClick={submitPin}
            className="mt-6 min-h-[52px] w-full rounded-2xl border-2 border-white/20 bg-[#2E5BFF] text-sm font-black uppercase tracking-[0.12em] text-white transition hover:bg-[#3A6DFF] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
          >
            Unlock
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full bg-[#07090B] text-[#F2F5F7]">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-white/10 bg-[#0B0E12]">
        <div className="border-b border-white/10 p-4">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="min-h-[48px] w-full rounded-2xl border border-white/15 bg-white/5 px-4 text-left text-xs font-black uppercase tracking-[0.12em] text-white/85 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
          >
            🏠 Back to Kiosk
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-2 p-4" aria-label="Admin sections">
          <button
            type="button"
            onClick={() => setActiveTab("stock")}
            className={[
              "min-h-[52px] w-full rounded-2xl border px-4 text-left text-sm font-bold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80",
              activeTab === "stock"
                ? "border-white/25 bg-white/10 text-white"
                : "border-transparent bg-transparent text-white/65 hover:bg-white/5",
            ].join(" ")}
            aria-pressed={activeTab === "stock"}
          >
            📦 Stock at Venues
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("challans")}
            className={[
              "min-h-[52px] w-full rounded-2xl border px-4 text-left text-sm font-bold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80",
              activeTab === "challans"
                ? "border-white/25 bg-white/10 text-white"
                : "border-transparent bg-transparent text-white/65 hover:bg-white/5",
            ].join(" ")}
            aria-pressed={activeTab === "challans"}
          >
            📄 Manage Challans
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={[
              "min-h-[52px] w-full rounded-2xl border px-4 text-left text-sm font-bold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80",
              activeTab === "history"
                ? "border-white/25 bg-white/10 text-white"
                : "border-transparent bg-transparent text-white/65 hover:bg-white/5",
            ].join(" ")}
            aria-pressed={activeTab === "history"}
          >
            📜 Stock History
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("ledger")}
            className={[
              "min-h-[52px] w-full rounded-2xl border px-4 text-left text-sm font-bold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80",
              activeTab === "ledger"
                ? "border-white/25 bg-white/10 text-white"
                : "border-transparent bg-transparent text-white/65 hover:bg-white/5",
            ].join(" ")}
            aria-pressed={activeTab === "ledger"}
          >
            📤 Data Export
          </button>
        </nav>

        <div className="border-t border-white/10 p-4">
          <button
            type="button"
            onClick={() => {
              setIsAuthenticated(false);
              setPin("");
              setPinError(false);
            }}
            className="min-h-[48px] w-full rounded-2xl border border-white/15 bg-white/5 px-4 text-xs font-black uppercase tracking-[0.12em] text-white/75 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
          >
            Lock / Logout
          </button>
        </div>
      </aside>

      <main className="min-h-0 flex-1 overflow-auto p-6 md:p-8">
        <header className="mb-8 border-b border-white/10 pb-6">
          <h1 className="text-xl font-black uppercase tracking-[0.12em] text-white/90">Admin dashboard</h1>
          <p className="mt-1 text-sm text-white/50">
            {activeTab === "stock"
              ? "Movement totals by venue"
              : activeTab === "challans"
                ? "Search and manage delivery challans"
                : activeTab === "history"
                  ? "Venue inventory balance by date"
                  : "Download raw movement data (CSV) for your venues and date range"}
          </p>
        </header>

        {activeTab === "stock" ? (
          <section aria-labelledby="stock-outstanding-heading">
            <h2 id="stock-outstanding-heading" className="mb-4 text-sm font-black uppercase tracking-[0.14em] text-white/55">
              Outstanding balances (all movements)
            </h2>
            <StockAtVenuesView />
          </section>
        ) : activeTab === "challans" ? (
          <AdminManageChallansView />
        ) : activeTab === "history" ? (
          <VenueSnapshot />
        ) : (
          <SequenceLedgerView />
        )}
      </main>
    </div>
  );
}
