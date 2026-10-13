import { z } from "zod";

export const agentKinds = {
  taxation: {
    title: "Tax preparation",
    purpose: "Identify missing tax inputs, reconcile supplied facts and prepare a review checklist.",
  },
  compliance: {
    title: "Compliance review",
    purpose: "Review recorded obligations, maintained due dates, missing evidence and next actions.",
  },
  legal: {
    title: "Legal paperwork",
    purpose: "Prepare a document outline and identify clauses or facts requiring professional review.",
  },
  documentation: {
    title: "Document review",
    purpose: "Check the recorded document checklist, missing items and review status.",
  },
  finance: {
    title: "Finance review",
    purpose: "Review recorded invoices, receipts, outstanding amounts and finance follow-up actions.",
  },
} as const;
export type AgentKind = keyof typeof agentKinds;
export const briefSchema = z.object({
  kind: z.enum(["taxation", "compliance", "legal", "documentation", "finance"]),
  title: z.string().trim().min(3).max(160),
  brief: z.string().trim().min(20).max(6000),
  jurisdiction: z.string().trim().min(2).max(120),
  period: z.string().trim().min(2).max(120),
  clientId: z.union([z.uuid(), z.literal("")]),
  requestId: z.uuid(),
});
const shortText = z.string().trim().min(1).max(1000);
export const outputSchema = z
  .object({
    summary: z.string().trim().min(1).max(3000),
    findings: z.array(z.object({ text: shortText, sourceIds: z.array(z.string().max(100)).min(1).max(10) })).max(20),
    missingInformation: z.array(shortText).max(20),
    nextActions: z.array(shortText).max(20),
    reviewNotes: z.string().trim().min(1).max(2000),
  })
  .strict();
export type AgentOutput = z.infer<typeof outputSchema>;
export type AgentSource = { id: string; title: string; content: string; url?: string };
export type AgentJob = {
  id: string;
  created_by: string;
  kind: AgentKind;
  title: string;
  brief: string;
  jurisdiction: string;
  period: string;
  client_id: string | null;
  state: "draft" | "running" | "needs_review" | "approved" | "rejected" | "failed";
  output: AgentOutput | null;
  sources: AgentSource[];
  model: string | null;
  error_message: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  attempts: number;
};

export function validateAgentOutput(value: unknown, sources: AgentSource[]): AgentOutput {
  const result = outputSchema.parse(value);
  const allowed = new Set(sources.map((source) => source.id));
  if (result.findings.some((finding) => finding.sourceIds.some((id) => !allowed.has(id)))) {
    throw new Error("AI returned references outside the supplied records.");
  }
  return result;
}
