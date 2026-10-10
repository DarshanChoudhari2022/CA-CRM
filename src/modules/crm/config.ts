export const crmModules = {
  clients: {
    title: "Clients",
    statuses: ["active", "inactive"],
    contacts: true,
    client: false,
    due: false,
    amount: false,
  },
  leads: {
    title: "Lead pipeline",
    statuses: ["new", "contacted", "qualified", "won", "lost"],
    contacts: true,
    client: true,
    due: true,
    amount: false,
  },
  documents: {
    title: "Document hub",
    statuses: ["requested", "received", "reviewed", "rejected"],
    contacts: false,
    client: true,
    due: true,
    amount: false,
  },
  compliance: {
    title: "Compliance calendar",
    statuses: ["pending", "in_progress", "filed", "blocked"],
    contacts: false,
    client: true,
    due: true,
    amount: false,
  },
  invoices: {
    title: "Invoices & collections",
    statuses: ["draft", "issued", "void"],
    contacts: false,
    client: true,
    due: true,
    amount: true,
  },
  tasks: {
    title: "Tasks",
    statuses: ["todo", "in_progress", "done", "blocked"],
    contacts: false,
    client: true,
    due: true,
    amount: false,
  },
  support: {
    title: "Support inbox",
    statuses: ["open", "assigned", "resolved", "escalated"],
    contacts: false,
    client: true,
    due: true,
    amount: false,
  },
} as const;
export type CrmModule = keyof typeof crmModules;
export function isCrmModule(value: string): value is CrmModule {
  return Object.hasOwn(crmModules, value);
}
export type CrmRecord = {
  id: string;
  title: string;
  status: string;
  notes: string;
  owner_id: string | null;
  client_id?: string | null;
  email?: string;
  phone?: string;
  due_date?: string;
  amount?: number;
  storage_path?: string;
  created_at: string;
};
export type CrmOption = { id: string; title: string };
