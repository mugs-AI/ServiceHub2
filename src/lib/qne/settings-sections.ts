// WP4 correction — System Options tab sections (pure, testable).
// Ids keep the legacy #grp-* anchors so older deep links still open a tab.

export const SECTION_NAV = [
  { id: "grp-renewal", label: "Renewals & Coverage" },
  { id: "grp-field", label: "Field Work & Jobs" },
  { id: "grp-storage", label: "Storage & Attachments" },
  { id: "grp-access", label: "Access" },
] as const;

export type SectionId = (typeof SECTION_NAV)[number]["id"];

/** Map a URL hash to a tab; unknown or empty → Renewals & Coverage. */
export function sectionFromHash(hash: string): SectionId {
  const id = String(hash ?? "").replace(/^#/, "");
  return SECTION_NAV.find((s) => s.id === id)?.id ?? "grp-renewal";
}
