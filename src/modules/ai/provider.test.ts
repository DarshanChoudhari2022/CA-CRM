import { afterEach, describe, expect, it, vi } from "vitest";
import { type AgentJob, validateAgentOutput } from "./domain";
import { generateAgentDraft } from "./provider";

const sources = [{ id: "reference:one", title: "Approved policy", content: "Verified firm policy." }];
const output = {
  summary: "Review these inputs.",
  findings: [{ text: "The supplied policy requires review.", sourceIds: ["reference:one"] }],
  missingInformation: ["Tax filing acknowledgement"],
  nextActions: ["Ask the client for evidence."],
  reviewNotes: "Professional review required.",
};
const job = {
  kind: "taxation",
  title: "Tax workpaper",
  brief: "Review inputs for the annual filing.",
  jurisdiction: "India",
  period: "FY 2026-27",
} as AgentJob;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("CA draft evidence and provider interface", () => {
  it("rejects fabricated references and unsupported findings", () => {
    expect(validateAgentOutput(output, sources).findings).toHaveLength(1);
    expect(() =>
      validateAgentOutput({ ...output, findings: [{ text: "Invented", sourceIds: ["unseen-source"] }] }, sources),
    ).toThrow("outside the supplied");
    expect(() =>
      validateAgentOutput({ ...output, findings: [{ text: "Unsupported", sourceIds: [] }] }, sources),
    ).toThrow();
  });
  it("allows missing information without unsupported findings", () => {
    expect(validateAgentOutput({ ...output, findings: [] }, []).missingInformation).toHaveLength(1);
  });
  it("fails before network calls when credentials are missing", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(generateAgentDraft(job, sources)).rejects.toThrow("configuration required");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("isolates untrusted data and validates the model response", async () => {
    vi.stubEnv("GROQ_API_KEY", "fixture");
    vi.stubEnv("GROQ_MODEL", "configured-model");
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(output) } }] }));
    vi.stubGlobal("fetch", fetch);
    expect(await generateAgentDraft(job, sources)).toEqual(output);
    const request = JSON.parse(fetch.mock.calls[0][1].body);
    expect(request.response_format.type).toBe("json_object");
    expect(request.tools).toBeUndefined();
    expect(request.messages[0].content).toContain("untrusted data");
    expect(request.messages[0].content).toContain("Do not invent statutory deadlines");
    expect(JSON.parse(request.messages[1].content).sources).toEqual(sources);
  });
  it("rejects malformed model JSON", async () => {
    vi.stubEnv("GROQ_API_KEY", "fixture");
    vi.stubEnv("GROQ_MODEL", "configured-model");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ choices: [{ message: { content: '{"summary":"not a workpaper"}' } }] })),
    );
    await expect(generateAgentDraft(job, sources)).rejects.toThrow();
  });
});
