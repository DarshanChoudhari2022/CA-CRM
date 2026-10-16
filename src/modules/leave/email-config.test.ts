import { expect, it } from "vitest";
import { leaveWeb3FormsKey } from "./email-config";

it("reuses the PSB website's shared Web3Forms key", () => {
  expect(leaveWeb3FormsKey({ WEB3FORMS_ACCESS_KEY: " website-key " })).toBe("website-key");
  expect(leaveWeb3FormsKey({ WEB3FORMS_ACCESS_KEY: "website-key", LEAVE_WEB3FORMS_ACCESS_KEY: " " })).toBe(
    "website-key",
  );
});
it("allows a dedicated leave key without hardcoding either recipient or credentials", () => {
  expect(leaveWeb3FormsKey({ WEB3FORMS_ACCESS_KEY: "website-key", LEAVE_WEB3FORMS_ACCESS_KEY: " leave-key " })).toBe(
    "leave-key",
  );
  expect(leaveWeb3FormsKey({})).toBeUndefined();
});
