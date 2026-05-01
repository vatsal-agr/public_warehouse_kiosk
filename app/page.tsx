"use client";

import { Box, LogIn, LogOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { useWarehouseStore } from "@/lib/store";

const SAFETY_YELLOW = "#FFD400";
const ACTION_GREEN = "#00B050";

const PIN_AUTO_SUBMIT_LEN = 4;
const INVALID_PIN_MS = 2800;

function WorkerLoginPanel() {
  const staff = useWarehouseStore((s) => s.staff);
  const [pin, setPin] = useState("");
  const [invalidPin, setInvalidPin] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleClearInvalid = useCallback(() => {
    if (errorClearRef.current) clearTimeout(errorClearRef.current);
    errorClearRef.current = setTimeout(() => {
      setInvalidPin(false);
      errorClearRef.current = null;
    }, INVALID_PIN_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (errorClearRef.current) clearTimeout(errorClearRef.current);
    };
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const tryLogin = useCallback(
    (entered: string) => {
      const trimmed = entered.trim();
      if (!trimmed) return;

      const match = staff.find((s) => String(s.pin).trim() === trimmed);
      if (match && useWarehouseStore.getState().loginWorker(match.name, trimmed)) {
        setPin("");
        setInvalidPin(false);
        if (errorClearRef.current) {
          clearTimeout(errorClearRef.current);
          errorClearRef.current = null;
        }
        return;
      }

      setPin("");
      setInvalidPin(true);
      scheduleClearInvalid();
    },
    [staff, scheduleClearInvalid],
  );

  const appendDigit = (d: string) => {
    setInvalidPin(false);
    if (errorClearRef.current) {
      clearTimeout(errorClearRef.current);
      errorClearRef.current = null;
    }
    setPin((p) => {
      if (p.length >= PIN_AUTO_SUBMIT_LEN) return p;
      const next = p + d;
      if (next.length === PIN_AUTO_SUBMIT_LEN) {
        queueMicrotask(() => tryLogin(next));
      }
      return next;
    });
  };

  const backspace = () => {
    setInvalidPin(false);
    setPin((p) => p.slice(0, -1));
  };

  const onHiddenInputChange = (raw: string) => {
    setInvalidPin(false);
    if (errorClearRef.current) {
      clearTimeout(errorClearRef.current);
      errorClearRef.current = null;
    }
    const digits = raw.replace(/\D/g, "").slice(0, PIN_AUTO_SUBMIT_LEN);
    setPin(digits);
    if (digits.length === PIN_AUTO_SUBMIT_LEN) {
      queueMicrotask(() => tryLogin(digits));
    }
  };

  if (staff.length === 0) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-amber-500/30 bg-amber-500/10 p-6 text-center text-sm text-amber-100/90">
        No staff found. Add rows to the <span className="font-mono">staff</span> table (columns{" "}
        <span className="font-mono">name</span>, <span className="font-mono">pin</span>).
      </div>
    );
  }

  const padKeys = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
  ] as const;

  return (
    <div className="mx-auto w-full max-w-[420px] rounded-3xl border border-white/10 bg-white/[0.06] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.5)] sm:p-8">
      <h2 className="text-center text-lg font-black uppercase tracking-[0.12em] text-white/90">Enter PIN</h2>
      <p className="mt-2 text-center text-xs text-white/45">Numeric code · auto sign-in at {PIN_AUTO_SUBMIT_LEN} digits</p>

      <label htmlFor="worker-pin" className="sr-only">
        Worker PIN
      </label>
      <input
        ref={inputRef}
        id="worker-pin"
        type="password"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        value={pin}
        onChange={(e) => onHiddenInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            tryLogin(pin);
          }
        }}
        className="mt-5 min-h-[56px] w-full rounded-2xl border border-white/15 bg-black/40 px-4 text-center text-2xl font-black tracking-[0.45em] text-white outline-none focus-visible:border-white/30 focus-visible:ring-4 focus-visible:ring-white/25"
        placeholder="••••"
        aria-invalid={invalidPin}
        aria-describedby={invalidPin ? "pin-error" : undefined}
      />

      <div className="mt-4 flex justify-center gap-2" aria-hidden>
        {Array.from({ length: PIN_AUTO_SUBMIT_LEN }, (_, i) => (
          <span
            key={i}
            className={`h-3 w-3 rounded-full border-2 ${
              i < pin.length ? "border-white/50 bg-white/70" : "border-white/25 bg-transparent"
            }`}
          />
        ))}
      </div>

      {invalidPin ? (
        <p id="pin-error" className="mt-4 text-center text-sm font-bold text-red-400" role="alert">
          Invalid PIN
        </p>
      ) : (
        <div className="mt-4 h-5" aria-hidden />
      )}

      <div className="mt-5 grid grid-cols-3 gap-3">
        {padKeys.flatMap((row) =>
          row.map((digit) => (
            <button
              key={digit}
              type="button"
              onClick={() => appendDigit(digit)}
              className="flex min-h-[72px] items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-2xl font-black text-white transition active:scale-[0.98] hover:bg-white/15 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 sm:min-h-[80px] sm:text-3xl"
            >
              {digit}
            </button>
          )),
        )}
        <button
          type="button"
          onClick={backspace}
          className="flex min-h-[72px] items-center justify-center rounded-2xl border border-white/15 bg-white/5 text-sm font-black uppercase tracking-wider text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 sm:min-h-[80px]"
        >
          ⌫
        </button>
        <button
          type="button"
          onClick={() => appendDigit("0")}
          className="flex min-h-[72px] items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-2xl font-black text-white transition active:scale-[0.98] hover:bg-white/15 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 sm:min-h-[80px] sm:text-3xl"
        >
          0
        </button>
        <button
          type="button"
          onClick={() => tryLogin(pin)}
          className="flex min-h-[72px] items-center justify-center rounded-2xl border-2 border-[#2E5BFF]/60 bg-[#2E5BFF] text-sm font-black uppercase tracking-[0.08em] text-white transition hover:bg-[#3A6DFF] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 sm:min-h-[80px]"
        >
          Enter
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const isLoaded = useWarehouseStore((s) => s.isLoaded);
  const activeWorker = useWarehouseStore((s) => s.activeWorker);
  const logoutWorker = useWarehouseStore((s) => s.logoutWorker);

  useEffect(() => {
    void useWarehouseStore.getState().fetchInitialData();
  }, []);

  const onStockOut = useCallback(() => {
    router.push("/picker?mode=out");
  }, [router]);

  const onStockIn = useCallback(() => {
    router.push("/picker?mode=in");
  }, [router]);

  const onManageChallans = useCallback(() => {
    router.push("/manage-challans");
  }, [router]);

  const onViewOldChallans = useCallback(() => {
    router.push("/history");
  }, [router]);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[color:var(--kiosk-bg,#07090B)] text-[#F2F5F7]">
      {/* Industrial background texture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 25% 10%, rgba(255,255,255,0.08), transparent 45%), radial-gradient(circle at 70% 30%, rgba(0,176,80,0.14), transparent 50%), repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 12px)",
        }}
      />
      {/* Scanline overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(255,255,255,0.05), rgba(255,255,255,0.00) 30%, rgba(255,255,255,0.04)), repeating-linear-gradient(to bottom, rgba(255,255,255,0.05) 0 1px, transparent 1px 4px)",
          mixBlendMode: "overlay",
          opacity: 0.5,
        }}
      />

      <header className="relative z-10 flex flex-wrap items-center justify-between gap-4 px-8 py-6">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/5 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]">
            <Box size={24} color="#D7E0E8" />
          </span>
          <div className="leading-tight">
            <div className="text-[clamp(1.25rem,2.1vw,1.9rem)] font-black tracking-[0.18em] text-white uppercase">
              WAREHOUSE STOCK KIOSK
            </div>
            <div className="mt-1 text-xs tracking-[0.22em] text-white/70 uppercase">
              {activeWorker ? `Signed in · ${activeWorker}` : "Worker sign-in required"}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {activeWorker ? (
            <button
              type="button"
              onClick={() => logoutWorker()}
              className="min-h-[44px] rounded-2xl border border-white/15 bg-white/5 px-4 text-xs font-black uppercase tracking-[0.12em] text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
            >
              Logout
            </button>
          ) : null}
        </div>
      </header>

      <main className="relative z-10 flex h-[calc(100vh-88px)] items-center justify-center px-6 pb-10">
        {!isLoaded ? (
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/55">Loading kiosk…</div>
        ) : !activeWorker ? (
          <div className="flex w-full max-w-[900px] flex-col items-center gap-8">
            <div className="text-center">
              <h1 className="text-xl font-black uppercase tracking-[0.14em] text-white/90">Worker login</h1>
              <p className="mt-2 text-sm text-white/50">Enter your numeric PIN to sign in</p>
            </div>
            <WorkerLoginPanel />
          </div>
        ) : (
          <div className="flex w-full max-w-[1400px] flex-col items-stretch justify-center gap-6">
            <div className="grid w-full grid-cols-1 grid-rows-2 gap-6 sm:grid-cols-2 sm:grid-rows-1">
              <KioskButton
                variant="out"
                background={SAFETY_YELLOW}
                textColor="#051106"
                onClick={onStockOut}
                label="STOCK OUT"
                icon={<LogOut size={52} />}
              />
              <KioskButton
                variant="in"
                background={ACTION_GREEN}
                textColor="#031308"
                onClick={onStockIn}
                label="STOCK IN"
                icon={<LogIn size={52} />}
              />
            </div>

            <button
              type="button"
              onClick={onManageChallans}
              className="min-h-[56px] w-full rounded-3xl border border-white/10 bg-white/5 px-6 py-3 text-center text-[0.98rem] font-black tracking-[0.08em] text-white/70 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
              aria-label="Manage today's challans"
            >
              MANAGE TODAY&apos;S CHALLANS
            </button>

            <button
              type="button"
              onClick={onViewOldChallans}
              className="min-h-[56px] w-full rounded-3xl border border-[#3a4049] bg-transparent px-6 py-3 text-center text-[0.98rem] font-black tracking-[0.08em] text-white/50 transition hover:border-[#4a525e] hover:bg-white/[0.03] hover:text-white/65 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
              aria-label="View old challans"
            >
              🗄️ VIEW OLD CHALLANS
            </button>
          </div>
        )}
      </main>

      {/* Subtle frame */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 border border-white/10"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-6 top-6 h-[3px] bg-gradient-to-r from-white/0 via-white/20 to-white/0"
      />
    </div>
  );
}

function KioskButton({
  variant,
  background,
  textColor,
  onClick,
  label,
  icon,
}: {
  variant: "out" | "in";
  background: string;
  textColor: string;
  onClick: () => void;
  label: string;
  icon: ReactNode;
}) {
  const borderColor =
    variant === "out" ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.35)";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="group relative flex h-full min-h-[220px] min-w-[220px] items-center justify-center overflow-hidden rounded-3xl border-2 shadow-[0_22px_60px_rgba(0,0,0,0.55)] outline-none focus-visible:ring-4 focus-visible:ring-white/80"
      style={{
        background,
        color: textColor,
        borderColor,
      }}
    >
      {/* glossy kiosk highlight */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-100"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0.0) 40%), radial-gradient(circle at 20% 10%, rgba(255,255,255,0.35), transparent 55%)",
          mixBlendMode: "soft-light",
        }}
      />

      {/* edge glow */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          boxShadow:
            variant === "out"
              ? "inset 0 0 0 2px rgba(255,255,255,0.18), inset 0 0 24px rgba(255,255,255,0.12)"
              : "inset 0 0 0 2px rgba(255,255,255,0.18), inset 0 0 24px rgba(255,255,255,0.10)",
        }}
      />

      <div className="relative z-10 flex w-full flex-col items-center justify-center gap-3 px-5 text-center">
        <div
          className="flex items-center justify-center rounded-2xl bg-white/10 px-5 py-3"
          style={{ boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.18)" }}
        >
          <span className="transition-transform duration-150 group-active:scale-[0.98]">
            {icon}
          </span>
        </div>

        <div className="text-[clamp(2rem,3.6vw,3.6rem)] font-black tracking-[0.12em] text-black/90 uppercase [text-shadow:0_2px_0_rgba(0,0,0,0.20)]">
          {label}
        </div>
      </div>

      {/* press feedback */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-0 transition-opacity duration-100 group-active:opacity-100"
        style={{
          background: "rgba(0,0,0,0.14)",
        }}
      />
      <span className="sr-only">
        {variant === "out" ? "Stock out action" : "Stock in action"}
      </span>
    </button>
  );
}
