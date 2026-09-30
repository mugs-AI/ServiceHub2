import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/inquiries/job-details")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        (await import("@/lib/qne/inquiry/handlers.server")).handleInquiry(request, "list"),
    },
  },
});
