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
