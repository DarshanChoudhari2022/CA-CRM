import { NextRequest } from "next/server";
import { expect, it } from "vitest";
import { isSameOrigin } from "./request-origin";

it("accepts direct and forwarded origins using the full scheme and host", () => {
  expect(
    isSameOrigin(
      new NextRequest("https://portal.example/api/auth/recovery", {
        headers: { origin: "https://portal.example" },
      }),
    ),
  ).toBe(true);
  expect(
    isSameOrigin(
      new NextRequest("http://localhost:3000/api/auth/recovery", {
        headers: {
          origin: "https://portal.example",
          "x-forwarded-host": "portal.example",
          "x-forwarded-proto": "https",
        },
      }),
    ),
  ).toBe(true);
});

it.each(["http://portal.example", "https://unrelated.example", "null"])("rejects origin %s", (origin) => {
  expect(
    isSameOrigin(
      new NextRequest("https://portal.example/api/auth/recovery", {
        headers: { origin },
      }),
    ),
  ).toBe(false);
});
