import type { ReferenceFields } from "@/lib/qne/service-jobs/pending-reference-search";

export function JobReferences({
  job,
  party,
}: {
  job: ReferenceFields;
  party?: "customer" | "vendor";
}) {
  const entries = [
    { party: "customer", label: "Customer reference", value: job.latest_customer_ref_no },
    { party: "vendor", label: "Vendor reference", value: job.latest_vendor_ref_no },
  ].filter((entry) => (party ? entry.party === party : !!entry.value));
  return (
    <div className="min-w-0 space-y-1 text-xs">
      {entries.map((entry) => (
        <div key={entry.party} className="break-all">
          <span className="text-muted-foreground">{entry.label}: </span>
          <span className="font-medium">{entry.value || "—"}</span>
        </div>
      ))}
    </div>
  );
}
