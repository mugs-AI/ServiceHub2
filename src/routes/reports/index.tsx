import { createFileRoute, Link } from "@tanstack/react-router";
import { useInquiryAccess } from "@/lib/qne/inquiry/use-inquiry-access";
export const Route = createFileRoute("/reports/")({ component: Reports });
function Reports() {
  const { access, error, reload } = useInquiryAccess();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Inquiries</h1>
      {error ? (
        <div role="alert">
          {error}{" "}
          <button onClick={reload} className="rounded border px-3 py-2">
            Retry
          </button>
        </div>
      ) : !access ? (
        <p role="status">Checking access…</p>
      ) : !access.can_view ? (
        <p>You do not have access to Job Details Inquiry.</p>
      ) : (
        <Link
          to="/reports/job-details"
          className="block rounded-lg border bg-card p-4 hover:bg-accent"
        >
          <span className="font-semibold">Job Details Inquiry →</span>
          <p className="mt-1 text-sm text-muted-foreground">
            Filter service Jobs, choose columns and export permitted results.
          </p>
        </Link>
      )}
    </div>
  );
}
