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

export interface AppTab {
  key: string;              // stable id
  label: string;            // display label
  href: string;             // navigable path
  closable: boolean;
  kind: "pinned" | "job";
}

interface TabsContextValue {
  tabs: AppTab[];
  activeKey: string | null;
  /**
   * Central open-or-focus helper. Opens the Job tab if absent, reuses it if it
   * already exists, and (unless `focus: false`) makes it the active tab by
   * navigating to it. Never creates a duplicate tab.
   */
  openJobTab: (jobId: string, jobNumber: string, opts?: { focus?: boolean }) => void;
  activate: (key: string) => void;
  close: (key: string) => void;
}


const TabsContext = createContext<TabsContextValue | null>(null);
const STORAGE_KEY = "sh2:openTabs:v1";

interface StoredTab {
  key: string;
  label: string;
  href: string;
}

function loadJobTabs(): StoredTab[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (t): t is StoredTab =>
        !!t && typeof t.key === "string" && typeof t.href === "string" && typeof t.label === "string",
    );
  } catch {
    return [];
  }
}

function saveJobTabs(tabs: StoredTab[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    /* ignore */
  }
}

export function TabsProvider({
  pinned,
  children,
}: {
  pinned: AppTab[];
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [jobTabs, setJobTabs] = useState<StoredTab[]>(() => loadJobTabs());

  useEffect(() => {
    saveJobTabs(jobTabs);
  }, [jobTabs]);

  const openJobTab = useCallback(
    (jobId: string, jobNumber: string) => {
      const key = `job:${jobId}`;
      setJobTabs((prev) => {
        if (prev.some((t) => t.key === key)) return prev;
        return [
          ...prev,
          { key, label: jobNumber || "Job", href: `/jobs/${jobId}` },
        ];
      });
    },
    [],
  );

  const activate = useCallback(
    (key: string) => {
      const all: AppTab[] = [
        ...pinned,
        ...jobTabs.map((t) => ({
          key: t.key,
          label: t.label,
          href: t.href,
          closable: true,
          kind: "job" as const,
        })),
      ];
      const t = all.find((x) => x.key === key);
      if (t) router.navigate({ to: t.href });
    },
    [pinned, jobTabs, router],
  );

  const close = useCallback(
    (key: string) => {
      setJobTabs((prev) => {
        const idx = prev.findIndex((t) => t.key === key);
        if (idx < 0) return prev;
        const next = prev.filter((t) => t.key !== key);
        // If closing the active tab, fall back to previous job tab or Workspace.
        const active = pathname;
        const closing = prev[idx];
        if (closing && active === closing.href) {
          const fallback = next[idx - 1] ?? next[0];
          const to = fallback ? fallback.href : (pinned[1]?.href ?? pinned[0]?.href ?? "/");
          router.navigate({ to });
        }
        return next;
      });
    },
    [pathname, pinned, router],
  );

  const tabs: AppTab[] = useMemo(
    () => [
      ...pinned,
      ...jobTabs.map((t) => ({
        key: t.key,
        label: t.label,
        href: t.href,
        closable: true,
        kind: "job" as const,
      })),
    ],
    [pinned, jobTabs],
  );

  const activeKey = useMemo(() => {
    const exact = tabs.find((t) => t.href === pathname);
    if (exact) return exact.key;
    // Fallback: prefix match for job pages
    const job = tabs.find(
      (t) => t.kind === "job" && pathname.startsWith(t.href),
    );
    return job?.key ?? null;
  }, [tabs, pathname]);

  const value = useMemo<TabsContextValue>(
    () => ({ tabs, activeKey, openJobTab, activate, close }),
    [tabs, activeKey, openJobTab, activate, close],
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

export function useTabs(): TabsContextValue {
  const v = useContext(TabsContext);
  if (!v) {
    // Safe no-op fallback (e.g. rendered outside provider during tests).
    return {
      tabs: [],
      activeKey: null,
      openJobTab: () => {},
      activate: () => {},
      close: () => {},
    };
  }
  return v;
}
