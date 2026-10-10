"use client";
import { useActionState } from "react";
import { type CrmModule, type CrmOption, type CrmRecord, crmModules } from "@/modules/crm/config";
import { convertLead, recordPayment, saveRecord } from "./actions";

export function RecordForm({
  module,
  item,
  clients,
  employees,
  admin,
}: {
  module: CrmModule;
  item?: CrmRecord;
  clients: CrmOption[];
  employees: CrmOption[];
  admin: boolean;
}) {
  const config = crmModules[module];
  const [state, action, pending] = useActionState(saveRecord, {});
  const suffix = item?.id ?? "new";
  return (
    <form action={action} className="card">
      <h2>{item ? "Edit record" : "Add record"}</h2>
      <input name="module" type="hidden" value={module} />
      <input name="id" type="hidden" value={item?.id ?? ""} />
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && <p role="status">{state.success}</p>}
      <div className="field">
        <label htmlFor={`title-${suffix}`}>Name / reference</label>
        <input id={`title-${suffix}`} name="title" defaultValue={item?.title} maxLength={200} required />
      </div>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor={`status-${suffix}`}>Status</label>
          <select id={`status-${suffix}`} name="status" defaultValue={item?.status ?? config.statuses[0]}>
            {config.statuses.map((status) => (
              <option key={status} value={status}>
                {status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`owner-${suffix}`}>Assigned employee</label>
          {admin ? (
            <select id={`owner-${suffix}`} name="owner_id" defaultValue={item?.owner_id ?? ""}>
              <option value="">Unassigned</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input name="owner_id" type="hidden" value={item?.owner_id ?? ""} />
              <span>{employees.find((e) => e.id === item?.owner_id)?.title ?? "Assigned"}</span>
            </>
          )}
        </div>
      </div>
      {config.client && (
        <div className="field">
          <label htmlFor={`client-${suffix}`}>Client</label>
          {admin ? (
            <select
              id={`client-${suffix}`}
              name="client_id"
              required={config.amount}
              defaultValue={item?.client_id ?? ""}
            >
              <option value="">Select client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          ) : (
            <input name="client_id" type="hidden" value={item?.client_id ?? ""} />
          )}
        </div>
      )}
      {config.contacts && (
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor={`email-${suffix}`}>Email</label>
            <input id={`email-${suffix}`} name="email" type="email" defaultValue={item?.email} />
          </div>
          <div className="field">
            <label htmlFor={`phone-${suffix}`}>Phone</label>
            <input id={`phone-${suffix}`} name="phone" defaultValue={item?.phone} maxLength={40} />
          </div>
        </div>
      )}
      {config.due && (
        <div className="field">
          <label htmlFor={`due-${suffix}`}>Due date</label>
          <input
            id={`due-${suffix}`}
            name="due_date"
            type="date"
            required={module === "compliance"}
            defaultValue={item?.due_date}
          />
        </div>
      )}
      {config.amount && (
        <div className="field">
          <label htmlFor={`amount-${suffix}`}>Amount (INR)</label>
          <input
            id={`amount-${suffix}`}
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={item?.amount}
            required
          />
        </div>
      )}
      <div className="field">
        <label htmlFor={`notes-${suffix}`}>{module === "support" ? "Query / draft reply / resolution" : "Notes"}</label>
        <textarea id={`notes-${suffix}`} name="notes" defaultValue={item?.notes} maxLength={4000} />
      </div>
      <button type="submit" className="button button-primary" disabled={pending}>
        {pending ? "Saving…" : "Save record"}
      </button>
    </form>
  );
}
export function PaymentForm({ invoice }: { invoice: string }) {
  const [state, action, pending] = useActionState(recordPayment, {});
  return (
    <form action={action}>
      <input type="hidden" name="invoice" value={invoice} />
      <h3>Record received payment</h3>
      <div className="field">
        <label>
          Amount (INR)
          <input name="amount" type="number" step="0.01" min="0.01" required />
        </label>
      </div>
      <div className="field">
        <label>
          Unique payment reference
          <input name="reference" minLength={3} maxLength={120} required />
        </label>
      </div>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && <p role="status">{state.success}</p>}
      <button type="submit" className="button button-secondary" disabled={pending}>
        Record payment
      </button>
    </form>
  );
}
export function ConvertButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(convertLead, {});
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="button button-secondary" disabled={pending}>
        Convert to client
      </button>
      {state.error && <p role="alert">{state.error}</p>}
      {state.success && <p role="status">{state.success}</p>}
    </form>
  );
}
