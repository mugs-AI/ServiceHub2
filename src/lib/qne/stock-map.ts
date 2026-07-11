// Local persistence for the Administrator's stock-code mapping.
// Keyed by N3 tenantCode so switching companies doesn't cross data.
// (Phase 2 will migrate this to Lovable Cloud with proper RLS.)

export type StockMappingType = "maintenance" | "adhoc";

export interface StockMapping {
  type: StockMappingType;
  durationDays?: number; // required when type === "maintenance"
}

export type StockMap = Record<string, StockMapping>;

function key(tenantCode: string) {
  return `qne_stock_map:${tenantCode}`;
}

export function loadStockMap(tenantCode: string): StockMap {
  if (typeof window === "undefined" || !tenantCode) return {};
  try {
    const raw = window.localStorage.getItem(key(tenantCode));
    return raw ? (JSON.parse(raw) as StockMap) : {};
  } catch {
    return {};
  }
}

export function saveStockMap(tenantCode: string, map: StockMap): void {
  if (typeof window === "undefined" || !tenantCode) return;
  try {
    window.localStorage.setItem(key(tenantCode), JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function setMapping(
  tenantCode: string,
  stockCode: string,
  mapping: StockMapping | null,
): StockMap {
  const map = loadStockMap(tenantCode);
  if (mapping === null) {
    delete map[stockCode];
  } else {
    map[stockCode] = mapping;
  }
  saveStockMap(tenantCode, map);
  return map;
}
