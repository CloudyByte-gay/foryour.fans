"use client";

import { type ReactElement, cloneElement, createContext, useContext, useId } from "react";
import { cn } from "@/lib/cn";
import { Label } from "./Label";

interface FormFieldContextValue {
  id: string;
  descriptionId: string;
  errorId: string;
  hasError: boolean;
}

const FormFieldContext = createContext<FormFieldContextValue | null>(null);

/**
 * Wires a label, control, hint and error message together for react-hook-form.
 * Spread `useFormField()` onto the control so `id`, `aria-describedby` and
 * `aria-invalid` are set consistently.
 */
export function FormField({
  children,
  error,
  className,
}: {
  children: React.ReactNode;
  error?: string;
  className?: string;
}) {
  const base = useId();
  const value: FormFieldContextValue = {
    id: `${base}-control`,
    descriptionId: `${base}-description`,
    errorId: `${base}-error`,
    hasError: Boolean(error),
  };

  return (
    <FormFieldContext.Provider value={value}>
      <div className={cn("space-y-1.5", className)}>
        {children}
        {error && (
          <p id={value.errorId} role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    </FormFieldContext.Provider>
  );
}

function useFormFieldContext(): FormFieldContextValue {
  const ctx = useContext(FormFieldContext);
  if (!ctx) throw new Error("FormField subcomponents must be used inside <FormField>");
  return ctx;
}

export function FormLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  const { id } = useFormFieldContext();
  return (
    <Label htmlFor={id} optional={optional}>
      {children}
    </Label>
  );
}

export function FormDescription({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { descriptionId } = useFormFieldContext();
  return (
    <p id={descriptionId} className={cn("text-sm text-muted", className)}>
      {children}
    </p>
  );
}

/**
 * Wire the field's `id` / `aria-describedby` / `aria-invalid` onto a single
 * control child, so `<FormLabel>` and the error text point at the right
 * element. The child's own props win on conflict.
 */
export function FormControl({ children }: { children: ReactElement }) {
  const field = useFormField();
  return cloneElement(children, { ...field, ...(children.props as object) });
}

/** Props to spread onto the field's input/textarea/select. */
export function useFormField(): {
  id: string;
  "aria-describedby": string;
  "aria-invalid": boolean;
} {
  const { id, descriptionId, errorId, hasError } = useFormFieldContext();
  return {
    id,
    "aria-describedby": hasError ? `${descriptionId} ${errorId}` : descriptionId,
    "aria-invalid": hasError,
  };
}
