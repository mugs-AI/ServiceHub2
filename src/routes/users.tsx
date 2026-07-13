import { createFileRoute } from "@tanstack/react-router";
import { AdminOnly } from "@/components/qne/AdminOnly";
import { N3ListExplorer } from "@/components/qne/N3ListExplorer";

export const Route = createFileRoute("/users")({
  component: () => (
    <AdminOnly>
      <N3ListExplorer
        title="N3 Users"
        hint="Users from the N3 platform-v1 scope. Used as the source for job assignees — no local shadow user table is created."
        defaultPath="/api/Users/Lookup"
        preferredColumns={["id", "userName", "email", "displayName", "isActive"]}
      />
    </AdminOnly>
  ),
});
