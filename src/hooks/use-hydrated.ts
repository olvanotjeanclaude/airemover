"use client";

import { useSyncExternalStore } from "react";

const subscribe = (): (() => void) => () => {};
const getClientSnapshot = (): boolean => true;
const getServerSnapshot = (): boolean => false;

/**
 * True once the client has hydrated. Uses `useSyncExternalStore` rather than a
 * `useState`/`useEffect` pair so it does not schedule a cascading render.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
