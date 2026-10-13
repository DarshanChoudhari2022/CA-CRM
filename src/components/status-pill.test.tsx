import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusPill } from "./status-pill";

describe("status meaning", () => {
  it.each([
    ["complete", "green"],
    ["incomplete", "amber"],
    ["active", "green"],
    ["inactive", "red"],
    ["rejected", "red"],
    ["not_started", "blue"],
  ])("renders %s with its actual state colour", (value, tone) => {
    expect(renderToStaticMarkup(<StatusPill value={value} />)).toContain(`status-${tone}`);
  });
});
