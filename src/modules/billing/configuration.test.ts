import { describe, expect, it } from "vitest";
import { readServiceForm, readSettingsForm } from "./configuration";

describe("billing configuration forms", () => {
  it("rejects blank prices instead of converting them to zero", () => {
    const form = new FormData();
    form.set("name", "Bookkeeping");
    form.set("unit_price", "");
    form.set("gst_rate", "18");
    form.set("active", "true");
    expect(readServiceForm(form).success).toBe(false);
  });

  it("keeps leading zeroes in account numbers and ignores unrelated settings", () => {
    const form = new FormData();
    form.set("account_number", "00123456789");
    form.set("legal_name", "Unrelated");
    const result = readSettingsForm("bank", form);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({ account_number: "00123456789" });
      expect(result.data).not.toHaveProperty("legal_name");
    }
  });
});
