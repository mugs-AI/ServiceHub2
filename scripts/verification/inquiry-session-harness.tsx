// Fixture-only browser harness: mount real providers without adding a product route.
import React from "react";
import { createRoot } from "react-dom/client";
import { SessionProvider, useSession } from "../../src/lib/qne/session-context";
import { useInquiryView } from "../../src/lib/qne/inquiry/InquiryViewProvider";
import { AuthGate } from "../../src/components/qne/AuthGate";
import { useTabs } from "../../src/lib/tabs";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router";
function View() {
  const view = useInquiryView();
  const tabs = useTabs();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <div>
      <output data-testid="view-identity">{view.identityKey}</output>
      <output data-testid="view-row">{view.snapshot.data?.rows[0]?.subject ?? ""}</output>
      <output data-testid="view-draft">{view.snapshot.draft.q}</output>
      <output data-testid="view-grants">{view.access?.can_view ? "allowed" : "denied"}</output>
      <output data-testid="view-error">{view.accessError}</output>
      <output data-testid="view-path">{pathname}</output>
      <button onClick={() => tabs.openJobTab("fixture-job", "SJ0001")}>Open scheduled Job</button>
      <button onClick={view.reloadAccess}>Verify access</button>
      <button
        onClick={() => view.update({ draft: { ...view.snapshot.draft, q: "retained-draft" } })}
      >
        Edit draft
      </button>
      <button onClick={() => view.apply(view.snapshot.query)}>Apply test query</button>
    </div>
  );
}
function Controls() {
  const session = useSession();
  return (
    <>
      <button onClick={() => void session.applyToken("fixture-rotated")}>Rotate credential</button>
      <button onClick={() => void session.applyToken("fixture-B")}>Switch actor</button>
      <button onClick={() => void session.applyToken("fixture-C")}>Switch company</button>
      <button onClick={() => void session.refresh()}>Verify session</button>
      {session.ready && session.token && (
        <AuthGate>
          <View />
        </AuthGate>
      )}
    </>
  );
}
const rootRoute = createRootRoute({ component: Controls });
const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/__inquiry_session_qa" }),
  createRoute({ getParentRoute: () => rootRoute, path: "/jobs/$jobId" }),
]);
const router = createRouter({ routeTree });
createRoot(document.getElementById("root")!).render(
  <SessionProvider>
    <RouterProvider router={router} />
  </SessionProvider>,
);
