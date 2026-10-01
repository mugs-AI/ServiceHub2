export interface DynamicTab {
  key: string;
  label: string;
  href: string;
  kind: "job" | "inquiry";
}
export const INQUIRY_TAB: DynamicTab = {
  key: "inquiry:job-details",
  label: "Job Details Inquiry",
  href: "/reports/job-details",
  kind: "inquiry",
};
export function sanitizeDynamicTabs(raw: unknown, inquiryAllowed: boolean): DynamicTab[] {
  if (!Array.isArray(raw)) return [];
  const tabs: DynamicTab[] = [];
  for (const input of raw.slice(0, 100)) {
    if (!input || typeof input !== "object") continue;
    const row = input as Record<string, unknown>;
    if (
      row.kind === "inquiry" &&
      inquiryAllowed &&
      row.key === INQUIRY_TAB.key &&
      row.href === INQUIRY_TAB.href
    ) {
      if (!tabs.some((t) => t.key === INQUIRY_TAB.key)) tabs.push({ ...INQUIRY_TAB });
      continue;
    }
    if (row.kind !== "job" || typeof row.href !== "string" || typeof row.label !== "string")
      continue;
    const match = /^\/jobs\/([A-Za-z0-9_-]+)$/.exec(row.href);
    if (
      !match ||
      ["new", "pending"].includes(match[1]) ||
      row.key !== `job:${match[1]}` ||
      tabs.some((t) => t.key === row.key)
    )
      continue;
    tabs.push({
      key: row.key as string,
      kind: "job",
      href: row.href,
      label: row.label.slice(0, 100) || "Job",
    });
  }
  return tabs;
}
export function openDynamicTab(tabs: readonly DynamicTab[], tab: DynamicTab): DynamicTab[] {
  const index = tabs.findIndex((t) => t.key === tab.key);
  return index < 0 ? [...tabs, tab] : tabs.map((t) => (t.key === tab.key ? tab : t));
}

export function closeDynamicTab(
  tabs: readonly DynamicTab[],
  key: string,
  inquiryAllowed: boolean | null,
): DynamicTab[] {
  return sanitizeDynamicTabs(tabs, inquiryAllowed !== false).filter((tab) => tab.key !== key);
}
