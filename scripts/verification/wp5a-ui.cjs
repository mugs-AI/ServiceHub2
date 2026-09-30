const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs");
// All API calls have fixture responses. Non-localhost browser traffic is blocked.
(async () => {
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    }),
    page = await context.newPage();
  const errors = [],
    unexpected = [],
    reads = [],
    exports = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let access = {
      can_view: true,
      scope: "own",
      can_export_excel: true,
      view_private_notes: false,
      view_gps: false,
    },
    failList = 0;
  const rows = Array.from({ length: 20 }, (_, i) => ({
    id: `job-${i}`,
    job_number: `SJ${String(i + 1).padStart(4, "0")}`,
    customer_code_snapshot: "C0001",
    customer_name_snapshot: "Fixture Customer",
    subject: "Fixture service request",
    status: "Assigned",
    priority: "Medium",
    assigned_user_name_snapshot: "Fixture PIC",
    created_at: "2026-09-29T16:30:00Z",
    scheduled_start_at: null,
    total_work_minutes: 0,
  }));
  await context.addInitScript(() => localStorage.setItem("qne_access_token", "fixture-token"));
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = (body) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/proxy")
      return json({
        code: "0000",
        data: {
          companyName: "Fixture Company",
          tenantCode: "fixture-A",
          email: "fixture@example.invalid",
        },
      });
    if (url.pathname === "/api/session/me")
      return json({
        tenantCode: "fixture-A",
        companyName: "Fixture Company",
        email: "fixture@example.invalid",
        displayName: "Fixture PIC",
        isAdministrator: false,
        isOwner: false,
        diagnostics: { matchedN3UserId: "fixture-user-A", reason: "matched_not_owner" },
      });
    if (url.pathname === "/api/inquiries/access") return json({ access });
    if (url.pathname === "/api/inquiries/job-details/export") {
      exports.push({ query: Object.fromEntries(url.searchParams), body: request.postDataJSON() });
      return route.fulfill({
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        body: fs.readFileSync("/tmp/wp5a-example.xlsx"),
      });
    }
    if (url.pathname === "/api/inquiries/job-details") {
      reads.push(Object.fromEntries(url.searchParams));
      if (failList)
        return route.fulfill({
          status: failList,
          contentType: "application/json",
          body: '{"error":"fixture"}',
        });
      const q = url.searchParams.get("q");
      if (q === "slow") await new Promise((r) => setTimeout(r, 350));
      const pageNo = Number(url.searchParams.get("page") || 1),
        filtered =
          q === "empty"
            ? []
            : q === "fast"
              ? [{ ...rows[0], subject: "Fast result" }]
              : pageNo === 2
                ? [{ ...rows[0], id: "job-21", job_number: "SJ0021" }]
                : rows;
      return json({
        rows: filtered,
        total: q === "empty" ? 0 : q === "fast" ? 1 : 21,
        page: pageNo,
        pageSize: Number(url.searchParams.get("pageSize") || 20),
        access,
      });
    }
    if (url.pathname.startsWith("/api/workspace/jobs/job-"))
      return json({ job: null, timeline: [], comments: [], attachments: [] });
    unexpected.push(url.pathname);
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.goto("http://127.0.0.1:5173/reports/job-details");
  const inquiryMenu = page.getByRole("button", { name: "Inquiry", exact: true });
  await inquiryMenu.waitFor({ timeout: 15000 }).catch(async (error) => {
    console.error({ body: await page.locator("body").innerText(), errors, unexpected });
    throw error;
  });
  const inquiryBox = await inquiryMenu.boundingBox();
  const toolsBox = await page.getByRole("button", { name: "Tools", exact: true }).boundingBox();
  assert(inquiryBox.x < toolsBox.x && Math.abs(inquiryBox.y - toolsBox.y) < 2);
  await inquiryMenu.click();
  await page.getByRole("link", { name: "Job Details Inquiry", exact: true }).waitFor();
  assert(await page.getByRole("button", { name: /Timeline History Inquiry/ }).isDisabled());
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  assert.equal(await page.getByRole("link", { name: "Inquiries", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("button", { name: "SJ0001", exact: true }).waitFor();
  assert.match(await page.locator("body").innerText(), /30\/09\/2026, 12:30 AM/);
  await page.getByRole("button", { name: "SJ0001", exact: true }).click();
  await page.waitForURL("**/jobs/job-0");
  assert(
    (await page.evaluate(() => JSON.parse(sessionStorage.getItem("sh2:openTabs:v1") || "[]"))).some(
      (tab) => tab.href === "/jobs/job-0" && tab.label === "SJ0001",
    ),
  );
  await page.goto("http://127.0.0.1:5173/reports/job-details");
  await page.getByRole("button", { name: "SJ0001", exact: true }).waitFor();
  await page.getByText("Columns (9)", { exact: true }).click();
  assert.equal(await page.getByLabel("Internal Note", { exact: true }).count(), 0);
  await page.getByLabel("Work Minutes", { exact: true }).check();
  assert.equal(await page.locator("tbody tr").first().locator("td").last().innerText(), "0");
  await page.getByText("Columns (10)", { exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "SJ0021", exact: true }).waitFor();
  await page.getByLabel("Filter Status", { exact: true }).selectOption("Completed");
  await page.getByLabel("Search", { exact: true }).fill("applied");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await page.getByRole("button", { name: "SJ0001", exact: true }).waitFor();
  await page.getByLabel("Search", { exact: true }).fill("unapplied");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Excel", exact: true }).click();
  await (await download).saveAs("/tmp/wp5a-ui-download.xlsx");
  assert.equal(exports.at(-1).query.q, "applied");
  assert.equal(JSON.parse(exports.at(-1).query.filters).status, "Completed");
  assert(exports.at(-1).body.columns.includes("total_work_minutes"));
  await page.screenshot({ path: "/tmp/wp5a-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/wp5a-phone.png", fullPage: true });
  const dims = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert(dims.scroll <= dims.width, JSON.stringify(dims));
  for (const width of [320, 375, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    const newJob = page
      .locator("header")
      .getByRole("link", { name: "New Service Job", exact: true });
    assert(await newJob.isVisible());
    const box = await newJob.boundingBox();
    assert(box.x >= 0 && box.x + box.width <= width && box.y < 60);
    assert.equal(await newJob.getAttribute("href"), "/jobs/new");
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert(layout.scroll <= layout.width, JSON.stringify(layout));
    await inquiryMenu.click();
    assert(await page.getByRole("link", { name: "Job Details Inquiry", exact: true }).isVisible());
    const popup = await page
      .getByRole("link", { name: "Job Details Inquiry", exact: true })
      .boundingBox();
    assert(popup.x >= 0 && popup.x + popup.width <= width);
    await inquiryMenu.click();
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(200);
    const headerBox = await page.getByRole("banner").boundingBox();
    const tabBox = await page.getByTestId("job-tabs-strip").boundingBox();
    assert(
      tabBox.y >= headerBox.y + headerBox.height - 1,
      "Job tabs must stay below header while scrolling",
    );
    if (width < 768) {
      await page.getByRole("button", { name: "Open menu" }).click();
      const expandedHeader = await page.getByRole("banner").boundingBox();
      const expandedTabs = await page.getByTestId("job-tabs-strip").boundingBox();
      assert(expandedTabs.y >= expandedHeader.y + expandedHeader.height - 1);
      await page.getByRole("button", { name: "Open menu" }).click();
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/servicehub-header-phone.png", fullPage: true });
  await page.getByLabel("Search", { exact: true }).fill("slow");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await page.getByLabel("Search", { exact: true }).fill("fast");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await page.getByText("Fast result", { exact: true }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(await page.getByText("Fast result", { exact: true }).count(), 1);
  await page.getByLabel("Search", { exact: true }).fill("empty");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await page.getByText("No Jobs match the applied filters.", { exact: true }).waitFor();
  failList = 401;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByText("Session expired. Reopen ServiceHub from N3.", { exact: true }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 0);
  failList = 0;
  access = { ...access, can_export_excel: false };
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByText("No Jobs match the applied filters.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Export Excel", exact: true }).count(), 0);
  access = { ...access, can_view: false };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByText("You do not have access to this inquiry.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Inquiry", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log(
    JSON.stringify(
      {
        desktop: true,
        phone: true,
        jobTab: true,
        noPageOverflow: true,
        appliedFilterExport: true,
        staleResponses: true,
        expiredSession: true,
        revokedAccess: true,
        apiRequests: reads.length,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
