"use client";

import { useEffect } from "react";

import { useWarehouseStore } from "@/lib/store";

/** Subscribes to Supabase Realtime for `products` and `venues`; mount once under the root layout. */
export function WarehouseRealtimeSubscriber() {
  useEffect(() => {
    return useWarehouseStore.getState().subscribeToChanges();
  }, []);

  return null;
}
