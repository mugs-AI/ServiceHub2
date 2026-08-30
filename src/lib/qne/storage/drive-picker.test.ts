// WP2A — Focused regression tests for the Google Picker folder selector.

import { describe, expect, it, vi } from "vitest";

import {
  FOLDER_MIME_TYPE,
  openFolderPicker,
  PICKER_ACCOUNT_GUIDANCE,
  type GoogleNamespace,
  type PickerData,
} from "./drive-picker";

interface Harness {
  google: GoogleNamespace;
  calls: string[];
  builderCalls: Record<string, unknown[]>;
  viewCalls: Record<string, unknown[]>;
  fire: (data: PickerData) => void;
  visibility: boolean[];
  builtCount: number;
}

function harness(): Harness {
  const calls: string[] = [];
  const builderCalls: Record<string, unknown[]> = {};
  const viewCalls: Record<string, unknown[]> = {};
  const visibility: boolean[] = [];
  let callback: ((d: PickerData) => void) | null = null;
  let builtCount = 0;

  const view = {
    setIncludeFolders(v: boolean) {
      calls.push("setIncludeFolders");
      viewCalls.setIncludeFolders = [v];
      return view;
    },
    setSelectFolderEnabled(v: boolean) {
      calls.push("setSelectFolderEnabled");
      viewCalls.setSelectFolderEnabled = [v];
      return view;
    },
    setOwnedByMe(v: boolean) {
      calls.push("setOwnedByMe");
      viewCalls.setOwnedByMe = [v];
      return view;
    },
    setMimeTypes(v: string) {
      calls.push("setMimeTypes");
      viewCalls.setMimeTypes = [v];
      return view;
    },
  };

  const builder = {
    setOAuthToken(t: string) {
      calls.push("setOAuthToken");
      builderCalls.setOAuthToken = [t];
      return builder;
    },
    setDeveloperKey(k: string) {
      calls.push("setDeveloperKey");
      builderCalls.setDeveloperKey = [k];
      return builder;
    },
    setOrigin(o: string) {
      calls.push("setOrigin");
      builderCalls.setOrigin = [o];
      return builder;
    },
    addView(v: unknown) {
      calls.push("addView");
      builderCalls.addView = [v];
      return builder;
    },
    setCallback(cb: (d: PickerData) => void) {
      calls.push("setCallback");
      callback = cb;
      return builder;
    },
    setAppId(id: string) {
      calls.push("setAppId");
      builderCalls.setAppId = [id];
      return builder;
    },
    build() {
      calls.push("build");
      builtCount += 1;
      return {
        setVisible(v: boolean) {
          calls.push(`setVisible:${v}`);
          visibility.push(v);
        },
      };
    },
  };

  return {
    google: {
      picker: {
        DocsView: function DocsView() {
          calls.push("DocsView");
          return view;
        } as unknown as GoogleNamespace["picker"] extends undefined
          ? never
          : NonNullable<GoogleNamespace["picker"]>["DocsView"],
        ViewId: { FOLDERS: "folders" },
        PickerBuilder: function PickerBuilder() {
          return builder;
        } as unknown as NonNullable<GoogleNamespace["picker"]>["PickerBuilder"],
      },
    },
    calls,
    builderCalls,
    viewCalls,
    visibility,
    fire: (d) => callback?.(d),
    get builtCount() {
      return builtCount;
    },
  } as Harness;
}

function open(h: Harness, over: Partial<Parameters<typeof openFolderPicker>[0]> = {}) {
  const onPicked = vi.fn();
  const onCancel = vi.fn();
  const instance = openFolderPicker({
    google: h.google,
    accessToken: "tok",
    apiKey: "key",
    appId: "app",
    origin: "https://servicehub.example",
    onPicked,
    onCancel,
    ...over,
  });
  return { instance, onPicked, onCancel };
}

describe("WP2A Google Picker folder selector", () => {
  it("restricts the view to folders owned by the connected account", () => {
    const h = harness();
    open(h);
    expect(h.viewCalls.setOwnedByMe).toEqual([true]);
    expect(h.viewCalls.setIncludeFolders).toEqual([true]);
    expect(h.viewCalls.setSelectFolderEnabled).toEqual([true]);
    expect(h.viewCalls.setMimeTypes).toEqual([FOLDER_MIME_TYPE]);
  });

  it("never enables Shared Drive support", () => {
    const h = harness();
    open(h);
    expect(h.calls.join(",")).not.toMatch(/enableFeature|SUPPORT_DRIVES/);
    expect((h.google.picker as unknown as { Feature?: unknown }).Feature).toBeUndefined();
  });

  it("sets the picker origin explicitly", () => {
    const h = harness();
    open(h, { origin: "https://exact.origin.test" });
    expect(h.builderCalls.setOrigin).toEqual(["https://exact.origin.test"]);
  });

  it("hides the picker before reporting a picked folder, exactly once", () => {
    const h = harness();
    const { onPicked, onCancel } = open(h);
    h.fire({ action: "picked", docs: [{ id: "folder-1" }] });
    expect(h.visibility).toEqual([true, false]);
    expect(onPicked).toHaveBeenCalledTimes(1);
    expect(onPicked).toHaveBeenCalledWith("folder-1");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("hides the picker and reports cancel without any selection", () => {
    const h = harness();
    const { onPicked, onCancel } = open(h);
    h.fire({ action: "cancel" });
    expect(h.visibility).toEqual([true, false]);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onPicked).not.toHaveBeenCalled();
  });

  it("treats a picked event with no folder id as a cancel", () => {
    const h = harness();
    const { onPicked, onCancel } = open(h);
    h.fire({ action: "picked", docs: [{}] });
    expect(onPicked).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated picker events", () => {
    const h = harness();
    const { onPicked, onCancel } = open(h);
    h.fire({ action: "loaded" });
    expect(onPicked).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("builds exactly one picker instance per call", () => {
    const h = harness();
    open(h);
    expect(h.calls.filter((c) => c === "build")).toHaveLength(1);
    expect(h.calls.filter((c) => c === "setVisible:true")).toHaveLength(1);
  });

  it("fails closed when the Picker API is unavailable", () => {
    expect(() =>
      openFolderPicker({
        google: {},
        accessToken: "t",
        apiKey: "k",
        origin: "https://x.test",
        onPicked: vi.fn(),
        onCancel: vi.fn(),
      }),
    ).toThrow(/could not be loaded/i);
  });

  it("provides account guidance text for the administrator", () => {
    expect(PICKER_ACCOUNT_GUIDANCE).toMatch(/account/i);
    expect(PICKER_ACCOUNT_GUIDANCE).not.toMatch(/token|secret/i);
  });
});

// ---------------------------------------------------------------------------
// Picker session controller lifecycle (double-click, duplicate terminal
// events, and unmount during pending awaits).
// ---------------------------------------------------------------------------

import { createPickerController, type OpenFolderPickerOptions } from "./drive-picker";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function controllerHarness(over: Partial<Parameters<typeof createPickerController>[0]> = {}) {
  const tokenGate = deferred<void>();
  const apiGate = deferred<void>();
  const visibility: boolean[] = [];
  const built: OpenFolderPickerOptions[] = [];
  const fetchToken = vi.fn(async () => {
    await tokenGate.promise;
    return { accessToken: "tok", apiKey: "key", appId: "app" };
  });
  const loadApi = vi.fn(async () => {
    await apiGate.promise;
  });
  const onPicked = vi.fn(async () => {});
  const onCancel = vi.fn();
  const onError = vi.fn();
  const busy: boolean[] = [];
  const controller = createPickerController({
    fetchToken,
    loadApi,
    getGoogle: () => harness().google,
    getOrigin: () => "https://servicehub.example",
    onPicked,
    onCancel,
    onError,
    onBusyChange: (b) => busy.push(b),
    buildPicker: (opts) => {
      built.push(opts);
      visibility.push(true);
      return { setVisible: (v: boolean) => visibility.push(v) };
    },
    ...over,
  });
  return {
    controller,
    tokenGate,
    apiGate,
    fetchToken,
    loadApi,
    onPicked,
    onCancel,
    onError,
    busy,
    built,
    visibility,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("WP2A Picker session controller", () => {
  it("ignores a second open while the first token request is pending", async () => {
    const h = controllerHarness();
    const first = h.controller.open();
    const second = h.controller.open();
    expect(h.fetchToken).toHaveBeenCalledTimes(1);
    h.tokenGate.resolve();
    h.apiGate.resolve();
    await Promise.all([first, second]);
    expect(h.fetchToken).toHaveBeenCalledTimes(1);
    expect(h.built).toHaveLength(1);
  });

  it("submits exactly one select_folder for duplicate picked events", async () => {
    const h = controllerHarness();
    const run = h.controller.open();
    h.tokenGate.resolve();
    h.apiGate.resolve();
    await run;
    const opts = h.built[0];
    void opts.onPicked("folder-1");
    void opts.onPicked("folder-1");
    await flush();
    expect(h.onPicked).toHaveBeenCalledTimes(1);
    expect(h.onPicked).toHaveBeenCalledWith("folder-1");
  });

  it("keeps the session busy until the picked save/refresh promise resolves", async () => {
    const saveGate = deferred<void>();
    const h = controllerHarness({ onPicked: vi.fn(() => saveGate.promise) });
    const run = h.controller.open();
    h.tokenGate.resolve();
    h.apiGate.resolve();
    await run;
    expect(h.controller.isActive()).toBe(true);
    expect(h.busy).toEqual([true]);

    // Picked: Picker hidden immediately, but the session must stay busy while
    // the deferred save/refresh (select_folder POST + connection reload) runs.
    void h.built[0].onPicked("folder-1");
    await flush();
    expect(h.visibility).toEqual([true, false]);
    expect(h.controller.isActive()).toBe(true);
    expect(h.busy).toEqual([true]);

    // Only after the save/refresh resolves may the session release.
    saveGate.resolve();
    await flush();
    expect(h.controller.isActive()).toBe(false);
    expect(h.busy).toEqual([true, false]);
  });

  it("latches the terminal event exactly once for picked→cancel, cancel→picked and duplicate cancel", async () => {
    const a = controllerHarness();
    let run = a.controller.open();
    a.tokenGate.resolve();
    a.apiGate.resolve();
    await run;
    void a.built[0].onPicked("f1");
    a.built[0].onCancel();
    await flush();
    expect(a.onPicked).toHaveBeenCalledTimes(1);
    expect(a.onCancel).not.toHaveBeenCalled();

    const b = controllerHarness();
    run = b.controller.open();
    b.tokenGate.resolve();
    b.apiGate.resolve();
    await run;
    b.built[0].onCancel();
    b.built[0].onCancel();
    void b.built[0].onPicked("f1");
    await flush();
    expect(b.onCancel).toHaveBeenCalledTimes(1);
    expect(b.onPicked).not.toHaveBeenCalled();
  });

  it("allows a new session after a terminal cancel and releases busy state", async () => {
    const h = controllerHarness();
    const run = h.controller.open();
    h.tokenGate.resolve();
    h.apiGate.resolve();
    await run;
    h.built[0].onCancel();
    expect(h.controller.isActive()).toBe(false);
    expect(h.busy).toEqual([true, false]);
    await h.controller.open();
    expect(h.fetchToken).toHaveBeenCalledTimes(2);
  });

  it("does not build a Picker when unmounted during the pending token fetch", async () => {
    const h = controllerHarness();
    const run = h.controller.open();
    h.controller.dispose();
    h.tokenGate.resolve();
    h.apiGate.resolve();
    await run;
    await flush();
    expect(h.built).toHaveLength(0);
    expect(h.loadApi).not.toHaveBeenCalled();
    expect(h.controller.isActive()).toBe(false);
  });

  it("does not build a Picker when unmounted during the pending Google API load", async () => {
    const h = controllerHarness();
    const run = h.controller.open();
    h.tokenGate.resolve();
    await flush();
    h.controller.dispose();
    h.apiGate.resolve();
    await run;
    await flush();
    expect(h.loadApi).toHaveBeenCalledTimes(1);
    expect(h.built).toHaveLength(0);
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("reports a launch failure once, clears the session and posts nothing", async () => {
    const h = controllerHarness({
      fetchToken: vi.fn(async () => {
        throw new Error("picker_token failed");
      }),
    });
    await h.controller.open();
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.onPicked).not.toHaveBeenCalled();
    expect(h.controller.isActive()).toBe(false);
  });

  it("hides the picker and clears the session on dispose", async () => {
    const h = controllerHarness();
    const run = h.controller.open();
    h.tokenGate.resolve();
    h.apiGate.resolve();
    await run;
    h.controller.dispose();
    expect(h.visibility).toEqual([true, false]);
    await h.controller.open();
    expect(h.fetchToken).toHaveBeenCalledTimes(1); // disposed controller never relaunches
  });
});
