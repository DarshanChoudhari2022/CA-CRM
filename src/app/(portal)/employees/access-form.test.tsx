import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ updateEmployeeAccess: vi.fn(), updateEmployeeManager: vi.fn() }));

import { EmployeeAccessForm } from "./access-form";

it("shows role and status controls directly instead of hiding them in a collapsed disclosure", () => {
  const access = { employee: "employee-id", role: "admin", active: true, linked: true };
  const html = renderToStaticMarkup(<EmployeeAccessForm {...access} />);
  expect(html).toContain('value="employee"');
  expect(html).toContain('value="admin"');
  expect(html).not.toContain("<details");
  expect(html).toContain('class="employee-access-form"');
});
