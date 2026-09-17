import { useId, type InputHTMLAttributes } from 'react';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  readonly label: string;
  /** Messaggio d'errore già tradotto; collegato al campo per i lettori di schermo. */
  readonly error?: string | null;
}

/** Campo di testo con label visibile, errore inline e hit target ≥ 44px. */
export function TextField({ label, error = null, className = '', ...rest }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error !== null}
        aria-describedby={error !== null ? errorId : undefined}
        className={[
          'min-h-[var(--hit-target)] rounded-md border bg-elevated px-3 text-base text-primary',
          error !== null ? 'border-danger' : 'border-subtle',
        ].join(' ')}
        {...rest}
      />
      {error !== null && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
