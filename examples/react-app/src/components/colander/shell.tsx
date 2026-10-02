import { Field, FieldDescription, FieldError, FieldLabel, FieldTitle } from "@/components/ui/field";

/**
 * The frame around a control: its label, its description, and the messages the
 * core reported against it.
 *
 * The generated module places the control where `{control}` appears, so this
 * writes the frame and the compiler writes what goes in it. The file is named
 * `shell` because it has no type of its own — it wraps every one.
 */
export default function FieldShell({
  id,
  label,
  required,
  description,
  errors,
  children,
}: {
  id: string;
  label: string;
  required: boolean;
  description?: string;
  errors: readonly string[];
  children: React.ReactNode;
}) {
  return (
    <Field data-invalid={errors.length > 0 ? true : undefined}>
      <FieldLabel htmlFor={id}>
        <FieldTitle>{label}</FieldTitle>
        {required ? (
          <span className="text-destructive" aria-label="required">
            *
          </span>
        ) : null}
      </FieldLabel>
      {children}
      {description === undefined ? null : <FieldDescription>{description}</FieldDescription>}
      {errors.length > 0 ? <FieldError errors={errors.map((message) => ({ message }))} /> : null}
    </Field>
  );
}
