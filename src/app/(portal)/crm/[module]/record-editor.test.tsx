// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ saveRecord: vi.fn(), convertLead: vi.fn(), recordPayment: vi.fn() }));

import { RecordEditor } from "./record-form";

it("mounts a form only on first expansion and preserves unsaved changes when closed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  document.body.append(container);
  try {
    await act(async () =>
      root.render(
        <RecordEditor module="tasks" clients={[{ id: "client", title: "Demo client" }]} employees={[]} admin />,
      ),
    );
    expect(container.querySelector("form")).toBeNull();
    const details = container.querySelector("details");
    if (!details) throw new Error("Missing editor disclosure");
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    const input = container.querySelector<HTMLInputElement>('input[name="title"]');
    if (!input) throw new Error("Form did not mount");
    input.value = "Unsaved work";
    expect(container.querySelector('option[value="client"]')?.textContent).toBe("Demo client");
    await act(async () => {
      details.open = false;
      details.dispatchEvent(new Event("toggle"));
    });
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(container.querySelector<HTMLInputElement>('input[name="title"]')?.value).toBe("Unsaved work");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
