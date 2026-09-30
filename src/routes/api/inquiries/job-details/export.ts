import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/inquiries/job-details/export")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        (await import("@/lib/qne/inquiry/handlers.server")).handleInquiry(request, "export"),
    },
  },
});
