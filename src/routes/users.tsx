import { createFileRoute } from "@tanstack/react-router";
import { N3ListExplorer } from "@/components/qne/N3ListExplorer";

export const Route = createFileRoute("/users")({
  component: () => (
    <N3ListExplorer
      title="N3 Users"
      hint="Users from the N3 platform-v1 scope. Used as the source for job assignees — no local shadow user table is created."
      defaultPath="/api/user"
      preferredColumns={["id", "userName", "email", "displayName", "isActive"]}
    />
  ),
});
