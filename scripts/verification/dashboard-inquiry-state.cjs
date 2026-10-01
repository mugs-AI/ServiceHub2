const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const assert = require("node:assert/strict");

// Synthetic API fixtures only; never allow browser requests to real services.
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    if (process.env.QA_SECTION === "inquiry") {
      await verifyInquiry(browser);
      return;
    }
    if (process.env.QA_SECTION === "session") {
      await verifySession(browser);
      return;
    }
    for (const width of [1440, 390]) {
      for (const admin of [false, true]) {
        const context = await browser.newContext({ viewport: { width, height: 1000 } });
        const page = await context.newPage();
        const pendingReads = [];
        const reference = "VEND-42-" + "X".repeat(100);
        const job = {
          id: "fixture-job",
          job_number: "SJ0001",
          subject: "Fixture repair",
          customer_code_snapshot: "C001",
          customer_name_snapshot: "Fixture Customer",
          status: "Waiting Vendor",
          priority: "High",
          created_at: "2026-10-01T01:00:00Z",
          assigned_user_id: "fixture-user",
          assigned_user_name_snapshot: "Fixture PIC",
          latest_customer_ref_no: "CUST-42",
          latest_vendor_ref_no: reference,
          completion_cycle: 1,
        };
        const requestRow = {
          ...job,
          request_id: "fixture-request",
          service_job_id: job.id,
          customer_name: job.customer_name_snapshot,
          customer_code: "C001",
          job_status: job.status,
          requested_at: job.created_at,
          reason: "Fixture reason",
          prior_status: "Assigned",
        };
        const errors = [],
          unexpected = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await context.addInitScript(() =>
          localStorage.setItem("qne_access_token", "fixture-token"),
        );
        await context.route("**/*", async (route) => {
          const url = new URL(route.request().url());
          if (url.hostname !== "127.0.0.1") return route.abort();
          if (!url.pathname.startsWith("/api/")) return route.continue();
          const json = (body) =>
            route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
          const identity = {
            tenantCode: "fixture-company",
            companyName: "Fixture Malaysia Service Company",
            email: "fixture@example.invalid",
          };
          if (url.pathname === "/api/proxy") return json({ code: "0000", data: identity });
          if (url.pathname === "/api/session/me")
            return json({
              ...identity,
              displayName: "Fixture Technician",
              isAdministrator: admin,
              isOwner: false,
              diagnostics: { matchedN3UserId: "fixture-user", reason: "matched_not_owner" },
            });
          if (url.pathname === "/api/inquiries/access")
            return json({
              access: {
                can_view: true,
                scope: admin ? "all" : "own",
                can_export_excel: true,
                view_private_notes: false,
                view_gps: false,
              },
            });
          if (url.pathname === "/api/admin/dashboard")
            return json({ summary: {}, userWorkload: [] });
          if (url.pathname === "/api/dashboard/my-work")
            return json({
              summary: {},
              jobs: [],
              total: 0,
              page: 1,
              pageSize: 20,
            });
          if (url.pathname === "/api/workspace/calendar") return json({ appointments: [] });
          if (url.pathname === "/api/diagnostics/health")
            return json({ tenantCode: "fixture-company", snapshots: [] });
          if (url.pathname === "/api/workspace/jobs/pending") {
            pendingReads.push(Object.fromEntries(url.searchParams));
            return json({ jobs: [job], total: 1, page: 1, pageSize: 50 });
          }
          if (
            ["/api/admin/cancellation-requests", "/api/workspace/reopen-requests"].includes(
              url.pathname,
            )
          ) {
            pendingReads.push(Object.fromEntries(url.searchParams));
            return json({ requests: [requestRow], total: 1, page: 1, pageSize: 50 });
          }
          if (url.pathname.endsWith("/cancellation"))
            return json({
              settings: { requesterPolicy: "all_users", approvalMode: "always" },
              canRequest: false,
              isAdmin: admin,
              activeRequest: null,
              history: [],
            });
          if (url.pathname.endsWith("/onsite-attendance"))
            return json({
              visits: [],
              activeVisit: null,
              canClockIn: false,
              canClockOut: false,
              users: [],
            });
          if (url.pathname.endsWith("/complete"))
            return json({ view: { mode: "hidden" }, completion: null });
          if (url.pathname.startsWith("/api/workspace/jobs/fixture-job"))
            return json({
              job,
              timeline: [],
              comments: [],
              attachments: [],
              sessions: [],
              requests: [],
            });
          unexpected.push(url.pathname);
          return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
        });
        await page.goto("http://127.0.0.1:5173/" + (admin ? "admin/dashboard" : "dashboard"));
        await page
          .getByRole("heading", { name: "Fixture Malaysia Service Company", exact: true })
          .waitFor({ timeout: 15000 });
        assert.equal(
          await page.getByTestId("compact-dashboard-header").getByRole("link").count(),
          0,
        );
        const original = page.url();
        // The section/card information must exist and not invoke its drill-down.
        await page
          .getByRole("button", {
            name: admin ? "Action Centre information" : "My work information",
            exact: true,
          })
          .click();
        await page.getByRole("dialog").waitFor();
        assert.equal(page.url(), original);
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        const cardInfo = page
          .locator('[data-dashboard-card] button[aria-label$="information"]')
          .first();
        await cardInfo.click();
        await page.getByRole("dialog").waitFor();
        assert.equal(page.url(), original);
        await page.mouse.click(1, 999);
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        if (width === 390 && !admin)
          assert(
            (await page
              .locator("[data-dashboard-card]")
              .first()
              .getByText("My Pending Tasks", { exact: true })
              .evaluate((el) => el.getBoundingClientRect().width)) >= 100,
            "Mobile card labels must have room for normal words",
          );
        await page.screenshot({
          path: `/tmp/servicehub-dashboard-${admin ? "admin" : "staff"}-${width}.png`,
          fullPage: true,
        });
        await page.goto("http://127.0.0.1:5173/jobs/fixture-job");
        const workflow = page
          .locator("section")
          .filter({ has: page.getByRole("heading", { name: "Workflow", exact: true }) });
        await workflow
          .getByText("Current status", { exact: true })
          .waitFor({ timeout: 10000 })
          .catch(async (e) => {
            console.error({ body: await page.locator("body").innerText(), errors, unexpected });
            throw e;
          });
        await workflow.getByText("Waiting Vendor", { exact: true }).waitFor();
        await workflow.getByText(reference, { exact: true }).waitFor();
        await workflow.getByRole("button", { name: "Start Work", exact: false }).waitFor();
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        for (const queue of [
          "waiting_vendor",
          "reopen_requests",
          ...(admin ? ["cancellation_requests"] : []),
        ]) {
          await page.goto("http://127.0.0.1:5173/jobs/pending?queueType=" + queue);
          await page.getByPlaceholder("Search job, subject, customer or reference").waitFor();
          await page.getByPlaceholder("Search job, subject, customer or reference").fill("VEND-42");
          await page.getByText(reference, { exact: true }).first().waitFor();
          await page.waitForFunction(() => !document.body.innerText.includes("Loading queue"));
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
          );
          assert(pendingReads.some((read) => read.q === "VEND-42"));
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(unexpected, []);
        console.log(
          "Dashboard info/card isolation passed: " + (admin ? "Admin" : "Staff") + " " + width,
        );
        await context.close();
      }
    }
    await verifyInquiry(browser);
    await verifySession(browser);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function verifyInquiry(browser) {
  for (const width of process.env.QA_WIDTH ? [Number(process.env.QA_WIDTH)] : [1440, 390]) {
    for (const admin of process.env.QA_ROLE === "staff"
      ? [false]
      : process.env.QA_ROLE === "admin"
        ? [true]
        : [false, true]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        acceptDownloads: true,
      });
      const page = await context.newPage(),
        reads = [],
        exports = [],
        errors = [],
        unexpected = [];
      page.on("pageerror", (e) => errors.push(e.message));
      let access = {
          can_view: true,
          scope: admin ? "all" : "own",
          can_export_excel: true,
          view_private_notes: true,
          view_gps: true,
        },
        delayAccess = 0,
        listDelay = 0,
        identity = { tenantCode: "fixture-A", userId: "fixture-user-A" },
        status = "Waiting Vendor";
      const job = {
        id: "fixture-job",
        job_number: "SJ0001",
        subject: "Fixture repair",
        customer_code_snapshot: "C001",
        customer_name_snapshot: "Fixture Customer",
        priority: "High",
        created_at: "2026-10-01T01:00:00Z",
        assigned_user_id: "fixture-user-A",
        assigned_user_name_snapshot: "Fixture PIC",
        latest_customer_ref_no: "CUST-42",
        latest_vendor_ref_no: "VEND-42",
        completion_cycle: 1,
        internal_note: "Fixture private note",
        total_work_minutes: 0,
      };
      await context.addInitScript(() => localStorage.setItem("qne_access_token", "fixture-token"));
      await context.route("**/*", async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        if (url.hostname !== "127.0.0.1") return route.abort();
        if (!url.pathname.startsWith("/api/")) return route.continue();
        const json = (body) =>
          route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
        if (url.pathname === "/api/proxy")
          return json({
            code: "0000",
            data: { ...identity, companyName: "Fixture Company", email: "fixture@example.invalid" },
          });
        if (url.pathname === "/api/session/me")
          return json({
            ...identity,
            companyName: "Fixture Company",
            displayName: "Fixture PIC",
            email: "fixture@example.invalid",
            isAdministrator: admin,
            diagnostics: { matchedN3UserId: identity.userId },
          });
        if (url.pathname === "/api/auth/connect")
          return json({
            code: "0000",
            data: { token: "fixture-token-B", ...identity, companyName: "Fixture Company" },
          });
        if (url.pathname === "/api/inquiries/access") {
          const response = { ...access };
          if (delayAccess) await new Promise((r) => setTimeout(r, delayAccess));
          return json({ access: response });
        }
        if (url.pathname === "/api/inquiries/job-details/export") {
          exports.push({
            query: Object.fromEntries(url.searchParams),
            body: request.postDataJSON(),
          });
          return route.fulfill({
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            body: Buffer.from("fixture-workbook"),
          });
        }
        if (url.pathname === "/api/inquiries/job-details") {
          const query = Object.fromEntries(url.searchParams),
            responseAccess = { ...access },
            actor = { ...identity };
          reads.push(query);
          if (listDelay) await new Promise((r) => setTimeout(r, listDelay));
          const pageNo = Number(query.page);
          return json({
            rows: [
              {
                ...job,
                status,
                id: pageNo === 2 ? "fixture-job-2" : job.id,
                job_number: pageNo === 2 ? "SJ0002" : job.job_number,
                subject: actor.tenantCode + " fixture result",
              },
            ],
            total: 21,
            page: pageNo,
            pageSize: Number(query.pageSize),
            access: responseAccess,
          });
        }
        if (url.pathname.endsWith("/status")) {
          status = "In Progress";
          return json({ ok: true });
        }
        if (url.pathname.endsWith("/purge")) return json({ ok: true });
        if (url.pathname === "/api/workspace/jobs/summary") return json({ summary: {} });
        if (url.pathname === "/api/workspace/jobs")
          return json({ jobs: [], total: 0, page: 1, pageSize: 20 });
        if (url.pathname.endsWith("/cancellation"))
          return json({
            settings: { requesterPolicy: "all_users", approvalMode: "always" },
            canRequest: false,
            isAdmin: admin,
            activeRequest: null,
            history: [],
          });
        if (url.pathname.endsWith("/onsite-attendance"))
          return json({ visits: [], openVisit: null, canAct: false, canViewAll: false });
        if (url.pathname.endsWith("/complete"))
          return json({ view: { mode: "hidden" }, canComplete: false });
        if (url.pathname.startsWith("/api/workspace/jobs/fixture-job"))
          return json({ job: { ...job, status }, timeline: [], comments: [], attachments: [] });
        unexpected.push(url.pathname);
        return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      });
      const inquiryTab = () =>
        page
          .getByTestId("job-tabs-strip")
          .getByRole("button", { name: "Inquiry Job Details Inquiry", exact: true });
      const apply = () => page.getByRole("button", { name: "Apply filters", exact: true }).click();
      await page.goto("http://127.0.0.1:5173/reports/job-details");
      await page.getByText("Apply filters to load Jobs.", { exact: true }).waitFor();
      await inquiryTab()
        .waitFor({ timeout: 10000 })
        .catch(async (e) => {
          console.error({ body: await page.locator("body").innerText(), errors, unexpected });
          throw e;
        });
      assert.equal(reads.length, 0, "cold Inquiry must wait for Apply");
      await page.getByLabel("Search", { exact: true }).fill("applied");
      await apply();
      await page.getByRole("button", { name: "SJ0001", exact: true }).waitFor();
      await page.getByText("Columns (9)", { exact: true }).click();
      await page.getByLabel("Internal Note", { exact: true }).check();
      await page
        .getByLabel("Filter Internal Note", { exact: true })
        .fill("unapplied-private-filter");
      // Put Subject before Job No. with accessible move controls.
      for (let i = 0; i < 3; i++)
        await page.getByRole("button", { name: "Move Subject up", exact: true }).click();
      assert.equal(
        await page.locator("thead th").first().getByRole("button").innerText(),
        "Subject",
      );
      await page.getByText("Columns (10)", { exact: true }).click();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.getByRole("button", { name: "SJ0002", exact: true }).waitFor();
      await page.getByLabel("Search", { exact: true }).fill("draft-unsaved-apply");
      const beforeBack = reads.length;
      await page.evaluate(() => window.scrollTo(0, 220));
      await page.evaluate(() =>
        document.addEventListener(
          "click",
          () => {
            window.__qaNavigationScroll = window.scrollY;
          },
          { once: true, capture: true },
        ),
      );
      await page.getByRole("button", { name: "SJ0002", exact: true }).click();
      await page.waitForURL("**/jobs/fixture-job-2");
      const retainedScroll = await page.evaluate(() => window.__qaNavigationScroll);
      await inquiryTab().click();
      await page.getByRole("button", { name: "SJ0002", exact: true }).waitFor();
      assert.equal(reads.length, beforeBack);
      await page
        .waitForFunction((y) => Math.abs(window.scrollY - y) <= 2, retainedScroll, {
          timeout: 2000,
        })
        .catch(async (e) => {
          console.error({
            expectedScroll: retainedScroll,
            actualScroll: await page.evaluate(() => scrollY),
          });
          throw e;
        });
      assert.equal(
        await page.getByLabel("Search", { exact: true }).inputValue(),
        "draft-unsaved-apply",
      );
      delayAccess = 450;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.waitForTimeout(80);
      assert.equal(await page.getByText("Checking inquiry access…", { exact: true }).count(), 0);
      assert(await page.getByRole("button", { name: "SJ0002", exact: true }).isVisible());
      await page.waitForTimeout(500);
      delayAccess = 0;
      assert.equal(reads.length, beforeBack);
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export Excel", exact: true }).click();
      await download;
      assert.equal(exports.at(-1).query.q, "applied");
      assert.equal(exports.at(-1).body.columns[0], "subject");
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({
        path: `/tmp/servicehub-inquiry-results-${admin ? "admin" : "staff"}-${width}.png`,
        fullPage: true,
      });
      await page.reload();
      await page.getByText("Apply filters to load Jobs.", { exact: true }).waitFor();
      assert.equal(reads.length, beforeBack);
      assert.equal(
        await page.getByLabel("Search", { exact: true }).inputValue(),
        "draft-unsaved-apply",
      );
      assert.equal(
        await page.locator("thead th").first().getByRole("button").innerText(),
        "Subject",
      );
      const saved = await page.evaluate(() =>
        Object.entries(localStorage)
          .filter(([key]) => key.startsWith("sh2:inquiry:"))
          .map(([, value]) => JSON.parse(value)),
      );
      assert(saved.length === 1);
      assert.deepEqual(Object.keys(saved[0]).sort(), [
        "applied",
        "columnOrder",
        "draft",
        "selectedColumns",
        "version",
      ]);
      await apply();
      await page.getByRole("button", { name: "SJ0001", exact: true }).waitFor();
      await page.getByRole("button", { name: "SJ0001", exact: true }).click();
      await page.waitForURL("**/jobs/fixture-job");
      // A browser reload on a Job must restore the previously open Inquiry tab.
      const beforeJobReload = reads.length;
      await page.reload();
      await inquiryTab().waitFor();
      assert.equal(reads.length, beforeJobReload);
      await inquiryTab().click();
      await page.getByText("Apply filters to load Jobs.", { exact: true }).waitFor();
      await apply();
      await page.getByRole("button", { name: "SJ0001", exact: true }).waitFor();
      await page.getByRole("button", { name: "SJ0001", exact: true }).click();
      await page.waitForURL("**/jobs/fixture-job");
      await page.getByRole("button", { name: "Start Work", exact: true }).click();
      await inquiryTab().click();
      await page
        .getByText("Job changes are available. Use Refresh to update these results.", {
          exact: true,
        })
        .waitFor();
      const beforeRefresh = reads.length;
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.getByRole("button", { name: "SJ0001", exact: true }).waitFor();
      assert.equal(reads.length, beforeRefresh + 1);
      if (admin) {
        await page.getByRole("button", { name: "SJ0001", exact: true }).click();
        await page.waitForURL("**/jobs/fixture-job");
        await page.getByRole("button", { name: "Permanently delete…", exact: true }).click();
        await page.getByRole("button", { name: "I understand, continue", exact: true }).click();
        await page.getByPlaceholder("SJ0001", { exact: true }).fill("SJ0001");
        await page.getByRole("button", { name: "Permanently delete", exact: true }).click();
        await page.waitForURL("**/support");
        await inquiryTab().click();
        await page
          .getByText("Job changes are available. Use Refresh to update these results.", {
            exact: true,
          })
          .waitFor({ timeout: 2000 });
      }
      access = { ...access, view_private_notes: false, view_gps: false, scope: "own" };
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.getByText("Apply filters to load Jobs.", { exact: true }).waitFor();
      assert.equal(await page.getByText("Fixture private note", { exact: true }).count(), 0);
      await page.getByRole("button", { name: "Clear filters", exact: true }).click();
      assert.equal(await page.getByLabel("Search", { exact: true }).inputValue(), "");
      assert.equal(
        await page.locator("thead th").first().getByRole("button").innerText(),
        "Subject",
      );
      await page.getByRole("button", { name: "Reset · 3 months", exact: true }).click();
      assert.equal(
        await page.locator("thead th").first().getByRole("button").innerText(),
        "Job No.",
      );
      await page.getByText("Columns (9)", { exact: true }).click();
      for (const label of [
        "Job No.",
        "Customer Code",
        "Customer",
        "Subject",
        "Status",
        "Priority",
        "Primary PIC",
        "Created",
        "Scheduled",
      ])
        await page.getByLabel(label, { exact: true }).uncheck();
      await page
        .getByText("Choose at least one column to display Jobs and export Excel.", { exact: true })
        .waitFor();
      assert(await page.getByRole("button", { name: "Export Excel", exact: true }).isDisabled());
      await page.getByRole("button", { name: "Reset · 3 months", exact: true }).click();
      const beforeClose = reads.length;
      await page.getByRole("button", { name: "Close Job Details Inquiry", exact: true }).click();
      await page.waitForURL("**/jobs/fixture-job*");
      await page.getByRole("button", { name: "Inquiry", exact: true }).click();
      await page.getByRole("link", { name: "Job Details Inquiry", exact: true }).click();
      await page.getByText("Apply filters to load Jobs.", { exact: true }).waitFor();
      assert.equal(reads.length, beforeClose);
      assert.equal(await inquiryTab().count(), 1);
      // Simulate durable preference storage unavailable after session token loading.
      await page.evaluate(() => {
        const originalGet = Storage.prototype.getItem,
          originalSet = Storage.prototype.setItem;
        Storage.prototype.getItem = function (key) {
          if (key.startsWith("sh2:")) throw new Error("fixture denied");
          return originalGet.call(this, key);
        };
        Storage.prototype.setItem = function (key, value) {
          if (key.startsWith("sh2:")) throw new Error("fixture denied");
          return originalSet.call(this, key, value);
        };
      });
      await page.getByLabel("Search", { exact: true }).fill("storage-denied");
      await apply();
      await page.getByRole("button", { name: "SJ0001", exact: true }).waitFor();
      access = {
        can_view: false,
        scope: "own",
        can_export_excel: false,
        view_private_notes: false,
        view_gps: false,
      };
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.getByText("You do not have access to this inquiry.", { exact: true }).waitFor();
      assert.equal(await inquiryTab().count(), 0);
      assert.equal(await page.getByRole("button", { name: "SJ0001", exact: true }).count(), 0);
      await page.screenshot({
        path: `/tmp/servicehub-inquiry-${admin ? "admin" : "staff"}-${width}.png`,
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      assert.deepEqual(unexpected, []);
      console.log(
        `Inquiry cold/back/focus/preferences/export/revocation/storage/mobile passed: ${admin ? "Admin" : "Staff"} ${width}`,
      );
      await context.close();
    }
  }
}

async function verifySession(browser) {
  const context = await browser.newContext(),
    page = await context.newPage(),
    errors = [],
    unexpected = [],
    reads = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let listDelay = 0,
    actorDelay = 20;
  let failIdentity = false,
    failAccess = false;
  let abortedReads = 0;
  page.on("requestfailed", (req) => {
    if (new URL(req.url()).pathname === "/api/inquiries/job-details") abortedReads++;
  });
  let access = {
    can_view: true,
    scope: "all",
    can_export_excel: true,
    view_private_notes: false,
    view_gps: false,
  };
  const actorFor = (token) =>
    token === "fixture-B"
      ? { tenantCode: "fixture-A", userId: "user-B" }
      : token === "fixture-C"
        ? { tenantCode: "fixture-C", userId: "user-A" }
        : { tenantCode: "fixture-A", userId: "user-A" };
  await context.addInitScript(() => localStorage.setItem("qne_access_token", "fixture-token"));
  await context.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (url.pathname === "/__inquiry_session_qa")
      return route.fulfill({
        contentType: "text/html",
        body: '<html><head><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div><script type="module" src="/scripts/verification/inquiry-session-harness.tsx"></script></body></html>',
      });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = (body) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    const token = req.headers().authorization?.replace("Bearer ", ""),
      actor = actorFor(token);
    if (url.pathname === "/api/proxy")
      return json({
        code: "0000",
        data: { ...actor, companyName: "Fixture", email: "fixture@example.invalid" },
      });
    if (url.pathname === "/api/session/me") {
      if (failIdentity) return route.fulfill({ status: 500, body: "{}" });
      const delay = token === "fixture-B" ? actorDelay : 30;
      await new Promise((r) => setTimeout(r, delay));
      return json({
        ...actor,
        companyName: "Fixture",
        isAdministrator: true,
        diagnostics: { matchedN3UserId: actor.userId },
      });
    }
    if (url.pathname === "/api/inquiries/access") {
      if (failAccess)
        return route.fulfill({
          status: 503,
          body: JSON.stringify({ error: "Fixture access outage" }),
        });
      return json({ access });
    }
    if (url.pathname === "/api/inquiries/job-details") {
      reads.push(actor);
      if (listDelay) await new Promise((r) => setTimeout(r, listDelay));
      return json({
        rows: [{ id: "fixture-job", subject: actor.tenantCode + ":" + actor.userId }],
        total: 1,
        page: 1,
        pageSize: 20,
        access,
      });
    }
    unexpected.push(url.pathname);
    return route.fulfill({ status: 404, body: "{}" });
  });
  await page.goto("http://127.0.0.1:5173/__inquiry_session_qa");
  await page.waitForFunction(
    () => document.querySelector('[data-testid="view-grants"]')?.textContent === "allowed",
  );
  assert.equal(reads.length, 0);
  await page.getByRole("button", { name: "Apply test query" }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="view-row"]')?.textContent === "fixture-A:user-A",
  );
  await page.getByRole("button", { name: "Edit draft" }).click();
  const before = reads.length;
  await page.getByRole("button", { name: "Rotate credential" }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="view-row"]')?.textContent === "fixture-A:user-A",
  );
  await page.waitForTimeout(150);
  assert.equal(reads.length, before, "Verified same actor credential rotation must keep results");
  assert.equal(await page.getByTestId("view-draft").innerText(), "retained-draft");
  if (process.env.QA_REVIEW_CASE !== "navigation") {
    failIdentity = true;
    await page.getByRole("button", { name: "Verify session", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="view-identity"]')?.textContent === "",
    );
    await page.waitForTimeout(100);
    assert.equal(await page.getByTestId("view-row").innerText(), "");
    const beforeRecovery = reads.length;
    failIdentity = false;
    await page.getByRole("button", { name: "Verify session", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="view-grants"]')?.textContent === "allowed",
    );
    await page.waitForTimeout(100);
    assert.equal(
      await page.getByTestId("view-row").innerText(),
      "",
      "Completed identity failure must invalidate rows across same-actor recovery",
    );
    assert.equal(reads.length, beforeRecovery, "Identity recovery must wait for Apply");
    await page.getByRole("button", { name: "Apply test query" }).click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="view-row"]')?.textContent === "fixture-A:user-A",
    );
  }
  if (process.env.QA_REVIEW_CASE !== "identity") {
    failAccess = true;
    await page.getByRole("button", { name: "Verify access", exact: true }).click();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid="view-error"]')
        ?.textContent.includes("Fixture access outage"),
    );
    await page.getByRole("button", { name: "Open scheduled Job", exact: true }).click();
    await page.waitForTimeout(100);
    assert.equal(
      await page.getByTestId("view-path").innerText(),
      "/jobs/fixture-job",
      "Inquiry outage must not block Calendar/DaySchedule openJobTab navigation",
    );
    assert.equal(
      await page
        .getByTestId("job-tabs-strip")
        .getByRole("button", { name: "Job SJ0001", exact: true })
        .count(),
      1,
    );
    failAccess = false;
    await page.getByRole("button", { name: "Verify access", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="view-grants"]')?.textContent === "allowed",
    );
  }
  listDelay = 500;
  await page.getByRole("button", { name: "Apply test query" }).click();
  await page.waitForTimeout(50);
  const beforeNarrowAbort = abortedReads;
  access = { ...access, scope: "own" };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(150);
  assert(abortedReads > beforeNarrowAbort, "Grant changes must abort the broader pending read");
  access = { ...access, scope: "all" };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: "Apply test query" }).click();
  await page.getByRole("button", { name: "Switch actor" }).click();
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="view-identity"]')?.textContent.includes("user-B"),
  );
  await page.waitForTimeout(550);
  assert.equal(await page.getByTestId("view-row").innerText(), "");
  assert.equal(await page.getByTestId("view-draft").innerText(), "");
  listDelay = 0;
  await page.getByRole("button", { name: "Apply test query" }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="view-row"]')?.textContent === "fixture-A:user-B",
  );
  await page.getByRole("button", { name: "Switch company" }).click();
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="view-identity"]')?.textContent.includes("fixture-C"),
  );
  assert.equal(await page.getByTestId("view-row").innerText(), "");
  actorDelay = 500;
  await page.getByRole("button", { name: "Switch actor" }).click();
  await page.getByRole("button", { name: "Switch company" }).click();
  await page.waitForTimeout(650);
  assert.match(
    await page.getByTestId("view-identity").innerText(),
    /fixture-C/,
    "Older session response must not replace the latest actor",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log("Session credential refresh, identity/company isolation and in-flight race passed");
  await context.close();
}
