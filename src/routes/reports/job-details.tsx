import { createFileRoute } from "@tanstack/react-router";
import { JobDetailsInquiry } from "@/components/qne/JobDetailsInquiry";
export const Route = createFileRoute("/reports/job-details")({
  head: () => ({ meta: [{ title: "Job Details Inquiry — ServiceHub" }] }),
  component: JobDetailsInquiry,
});
