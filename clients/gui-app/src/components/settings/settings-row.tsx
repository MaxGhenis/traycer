import type { ReactNode } from "react";

interface SettingsRowProps {
  label: string;
  description?: string;
  hint?: ReactNode;
  control: ReactNode;
}

export function SettingsRow(props: SettingsRowProps) {
  const { label, description, hint, control } = props;
  return (
    <div className="flex items-start justify-between gap-6 border-b border-border/40 px-5 py-4 last:border-b-0">
      <div className="min-w-0 space-y-1">
        <div className="font-medium text-foreground">{label}</div>
        {description ? (
          <p className="text-ui-sm text-muted-foreground">{description}</p>
        ) : null}
        {hint ? (
          <p className="text-ui-sm font-medium text-amber-700 dark:text-amber-300">
            {hint}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
