export async function inquiryRequest(
  url: string,
  token: string | null,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
      Authorization: `Bearer ${token ?? ""}`,
    },
  });
  if (response.ok) return response;
  if (response.status === 401) throw new Error("Session expired. Reopen ServiceHub from N3.");
  if (response.status === 403) throw new Error("You do not have access to this inquiry or export.");
  const body = await response.json().catch(() => ({}));
  throw new Error(typeof body.error === "string" ? body.error : "Unable to load Jobs. Try again.");
}
