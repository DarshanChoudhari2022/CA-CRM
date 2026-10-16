import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ updateEmployeeManager: vi.fn() }));

import { EmployeeManagerForm } from "./manager-form";

it("selects the current manager and keeps manager assignment separate from account permissions", () => {
  const html = renderToStaticMarkup(
    <EmployeeManagerForm employee="alice" manager="bob" managers={[{ id: "bob", name: "Bob Employee" }]} />,
  );
  expect(html).toContain('value="bob" selected=""');
  expect(html).toContain("No manager");
  expect(html).toContain("Save manager");
  expect(html).not.toContain('name="role"');
});
