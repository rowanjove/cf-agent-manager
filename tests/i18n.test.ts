import { describe, expect, it } from "vitest";

import { translate } from "../src/renderer/i18n";

describe("renderer localization", () => {
  it("uses Chinese copy by default at the application boundary", () => {
    expect(translate("zh-CN", "nav.overview")).toBe("概览");
    expect(translate("zh-CN", "settings.language")).toBe("界面语言");
  });

  it("supports English and interpolation", () => {
    expect(translate("en", "sync.last", { time: "10:00" })).toBe("Synced 10:00");
  });
});
