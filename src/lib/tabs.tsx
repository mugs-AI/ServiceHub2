import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import {
  INQUIRY_TAB,
  openDynamicTab,
  closeDynamicTab,
  sanitizeDynamicTabs,
  type DynamicTab,
} from "./dynamic-tabs";
export interface AppTab {
  key: string;
  label: string;
  href: string;
  closable: boolean;
  kind: "pinned" | "job" | "inquiry";
}
interface TabsContextValue {
  tabs: AppTab[];
  activeKey: string | null;
  openJobTab: (jobId: string, jobNumber: string, opts?: { focus?: boolean }) => void;
  openInquiryTab: (opts?: { focus?: boolean }) => void;
  activate: (key: string) => void;
  close: (key: string) => void;
}
const TabsContext = createContext<TabsContextValue | null>(null);
function storageKey(scope: string) {
  return `sh2:openTabs:v2:${encodeURIComponent(scope)}`;
}
function load(scope: string, allowed: boolean): DynamicTab[] {
  try {
    return sanitizeDynamicTabs(
      JSON.parse(window.sessionStorage.getItem(storageKey(scope)) ?? "[]"),
      allowed,
    );
  } catch {
    return [];
  }
}
export function TabsProvider({
  pinned,
  identityScope,
  inquiryAllowed,
  onCloseInquiry,
  children,
}: {
  pinned: AppTab[];
  identityScope: string | null;
  inquiryAllowed: boolean | null;
  onCloseInquiry: () => void;
  children: ReactNode;
}) {
  const router = useRouter(),
    pathname = useRouterState({ select: (s) => s.location.pathname });
  const [state, setState] = useState<{ scope: string | null; tabs: DynamicTab[] }>({
    scope: null,
    tabs: [],
  });
  const dynamic = useMemo(
    () =>
      state.scope === identityScope && identityScope
        ? sanitizeDynamicTabs(state.tabs, inquiryAllowed === true)
        : [],
    [state, identityScope, inquiryAllowed],
  );
  useEffect(() => {
    if (identityScope && state.scope !== identityScope)
      setState({ scope: identityScope, tabs: load(identityScope, inquiryAllowed !== false) });
    if (!identityScope && state.scope !== null) setState({ scope: null, tabs: [] });
  }, [identityScope, inquiryAllowed, state.scope]);
  useEffect(() => {
    if (inquiryAllowed === false)
      setState((previous) =>
        previous.tabs.some((tab) => tab.kind === "inquiry")
          ? { ...previous, tabs: sanitizeDynamicTabs(previous.tabs, false) }
          : previous,
      );
  }, [inquiryAllowed]);
  useEffect(() => {
    // Unknown Inquiry grants must not erase a saved tab during a Job-page reload.
    if (!identityScope || state.scope !== identityScope || inquiryAllowed === null) return;
    try {
      window.sessionStorage.setItem(storageKey(identityScope), JSON.stringify(dynamic));
    } catch {
      /* storage denied */
    }
  }, [identityScope, state.scope, dynamic, inquiryAllowed]);
  const open = useCallback(
    (tab: DynamicTab, opts?: { focus?: boolean }) => {
      const safe = sanitizeDynamicTabs([tab], inquiryAllowed === true)[0];
      if (!safe) return;
      if (identityScope)
        setState((previous) => ({
          scope: identityScope,
          tabs: openDynamicTab(
            previous.scope === identityScope
              ? sanitizeDynamicTabs(previous.tabs, inquiryAllowed !== false)
              : load(identityScope, inquiryAllowed !== false),
            safe,
          ),
        }));
      if (opts?.focus !== false && pathname !== safe.href)
        void router.navigate({ to: safe.href, resetScroll: safe.kind !== "inquiry" });
    },
    [identityScope, inquiryAllowed, pathname, router],
  );
  const openJobTab = useCallback(
    (jobId: string, jobNumber: string, opts?: { focus?: boolean }) =>
      open(
        { key: `job:${jobId}`, href: `/jobs/${jobId}`, label: jobNumber || "Job", kind: "job" },
        opts,
      ),
    [open],
  );
  const openInquiryTab = useCallback(
    (opts?: { focus?: boolean }) => open(INQUIRY_TAB, opts),
    [open],
  );
  useEffect(() => {
    if (pathname === INQUIRY_TAB.href && inquiryAllowed) openInquiryTab({ focus: false });
  }, [pathname, inquiryAllowed, openInquiryTab]);
  const tabs = useMemo<AppTab[]>(
    () => [...pinned, ...dynamic.map((t) => ({ ...t, closable: true }))],
    [pinned, dynamic],
  );
  const activate = useCallback(
    (key: string) => {
      const tab = tabs.find((t) => t.key === key);
      if (tab) void router.navigate({ to: tab.href, resetScroll: tab.kind !== "inquiry" });
    },
    [tabs, router],
  );
  const close = useCallback(
    (key: string) => {
      const index = dynamic.findIndex((t) => t.key === key),
        closing = dynamic[index];
      if (!closing) return;
      const next = dynamic.filter((t) => t.key !== key);
      setState((previous) => ({
        scope: identityScope,
        tabs: closeDynamicTab(
          previous.scope === identityScope ? previous.tabs : [],
          key,
          inquiryAllowed,
        ),
      }));
      if (closing.kind === "inquiry") onCloseInquiry();
      if (pathname === closing.href)
        void router.navigate({
          to: (next[index - 1] ?? next[0])?.href ?? pinned[1]?.href ?? "/support",
        });
    },
    [dynamic, identityScope, inquiryAllowed, onCloseInquiry, pathname, pinned, router],
  );
  const activeKey = tabs.find((t) => t.href === pathname)?.key ?? null;
  const value = useMemo(
    () => ({ tabs, activeKey, openJobTab, openInquiryTab, activate, close }),
    [tabs, activeKey, openJobTab, openInquiryTab, activate, close],
  );
  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}
export function useTabs(): TabsContextValue {
  return (
    useContext(TabsContext) ?? {
      tabs: [],
      activeKey: null,
      openJobTab: () => {},
      openInquiryTab: () => {},
      activate: () => {},
      close: () => {},
    }
  );
}
