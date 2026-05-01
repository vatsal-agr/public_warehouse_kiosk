"use client";

import { useEffect, useMemo, useRef } from "react";

export function useInactivityReset({
  enabled = true,
  timeoutMs,
  onReset,
}: {
  enabled?: boolean;
  timeoutMs: number;
  onReset: () => void;
}) {
  const onResetRef = useRef(onReset);

  const events = useMemo(() => {
    // Include common kiosk interactions (mouse + touch + pointer).
    return ["pointerdown", "mousedown", "mousemove", "touchstart", "touchmove"];
  }, []);

  useEffect(() => {
    onResetRef.current = onReset;
  }, [onReset]);

  useEffect(() => {
    if (!enabled) return;

    let lastActivity = Date.now();

    const markActivity = () => {
      lastActivity = Date.now();
    };

    events.forEach((evt) => window.addEventListener(evt, markActivity, { passive: true }));

    const intervalId = window.setInterval(() => {
      if (Date.now() - lastActivity >= timeoutMs) {
        window.clearInterval(intervalId);
        onResetRef.current();
      }
    }, 1000);

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, markActivity));
      window.clearInterval(intervalId);
    };
  }, [enabled, events, timeoutMs]);
}

