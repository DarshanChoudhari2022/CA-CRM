"use client";

import { type ReactNode, startTransition, useActionState } from "react";

export function ConfigurationForm({
  action,
  children,
  submit,
  secondary = false,
}: {
  action: (state: string, form: FormData) => Promise<string>;
  children?: ReactNode;
  submit: string;
  secondary?: boolean;
}) {
  const [error, dispatch, pending] = useActionState(action, "");

  return (
    <form
      action={dispatch}
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        startTransition(() => dispatch(form));
      }}
    >
      {children && (
        <fieldset disabled={pending} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {children}
        </fieldset>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className={secondary ? "billing-button" : "billing-button billing-primary"}
      >
        {pending ? "Working…" : submit}
      </button>
    </form>
  );
}
