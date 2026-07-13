// Central registry of official N3 Open API endpoints used by explorers and
// snapshot sync. Update ONLY from the official OpenAPI specifications at
// https://openapi.account.qne.cloud/doc/*.json — never from README or guesses.
//
// All list endpoints return the ApiResponse envelope with
// PageQueryResult in `data` (rows in `data.value`, total in `data.count`)
// and page with OData `$top` / `$skip` (per operation extension
// `x-qne-paging: odata-page`).

export type N3Target = "main" | "reporting";
export type N3EndpointPaging = "odata-page" | "single" | "none";

export interface N3EndpointDef {
  target: N3Target;
  method: "GET";
  path: string;
  paging: N3EndpointPaging;
  operationId: string;
  /** Documented resource / entity name (`x-qne-resource` / wiki entity). */
  resource: string;
}

export const N3_ENDPOINTS = {
  "customers.list": {
    target: "main",
    method: "GET",
    path: "/api/Customers/List",
    paging: "odata-page",
    operationId: "Customers_GetList_GET",
    resource: "Customers",
  },
  "stock.list": {
    target: "main",
    method: "GET",
    path: "/api/Stocks/List",
    paging: "odata-page",
    operationId: "Stocks_GetList_GET",
    resource: "Stocks",
  },
  "salesInvoices.list": {
    target: "main",
    method: "GET",
    path: "/api/SalesInvoices/List",
    paging: "odata-page",
    operationId: "SalesInvoices_GetList_GET",
    resource: "SalesInvoices",
  },
  "salesInvoices.get": {
    target: "main",
    method: "GET",
    // Full document with `itemDetails[]` (SalesInvoiceDetailDto).
    // `{key}` is the stable N3 document id (SalesInvoiceListDto.id).
    path: "/api/SalesInvoices/{key}",
    paging: "single",
    operationId: "SalesInvoices_GetByKey_GET",
    resource: "SalesInvoices",
  },
  "deliveryOrders.list": {
    target: "main",
    method: "GET",
    path: "/api/DeliveryOrders/List",
    paging: "odata-page",
    operationId: "DeliveryOrders_GetList_GET",
    resource: "DeliveryOrders",
  },
  "deliveryOrders.get": {
    target: "main",
    method: "GET",
    // Full document with `itemDetails[]` (DeliveryOrderDetailDto) and
    // `customerCode` (the DO list DTO omits customerCode).
    path: "/api/DeliveryOrders/{key}",
    paging: "single",
    operationId: "DeliveryOrders_GetByKey_GET",
    resource: "DeliveryOrders",
  },
  "users.list": {
    target: "main",
    method: "GET",
    path: "/api/Users/Lookup",
    paging: "single",
    operationId: "Users_GetLookupList_GET",
    resource: "Users",
  },
} as const satisfies Record<string, N3EndpointDef>;

export type N3EndpointKey = keyof typeof N3_ENDPOINTS;

export function n3Endpoint(key: N3EndpointKey): N3EndpointDef {
  return N3_ENDPOINTS[key];
}
