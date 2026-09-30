import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/inquiries/access")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        (await import("@/lib/qne/inquiry/handlers.server")).handleInquiry(request, "access"),
    },
  },
});
