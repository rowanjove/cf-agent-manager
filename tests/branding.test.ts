import { describe, expect, it } from "vitest";

import { APP_NAME, LEGACY_CREDENTIAL_SERVICE, LEGACY_USER_DATA_DIRECTORY } from "../src/branding";

describe("application branding", () => {
  it("uses the CF Nexarch public name", () => {
    expect(APP_NAME).toBe("CF Nexarch");
  });

  it("preserves legacy local identities during the rename", () => {
    expect(LEGACY_USER_DATA_DIRECTORY).toBe("CF Agent Manager");
    expect(LEGACY_CREDENTIAL_SERVICE).toBe("CFAgentManager/cloudflare");
  });
});
