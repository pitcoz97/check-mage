import { useId, type InputHTMLAttributes } from 'react';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  readonly label: string;
  /** Messaggio d'errore già tradotto; collegato al campo per i lettori di schermo. */
  readonly error?: string | null;
}

/**
 * Campo di testo con label visibile, errore inline e hit target ≥ 44px. Il design non lo disegna: prende la superficie
 * incassata e l'anello spento dei controlli inattivi (REDESIGN_PLAN.md §10, D20).
 */
export function TextField({ label, error = null, className = '', ...rest }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-13 font-bold">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error !== null}
        aria-describedby={error !== null ? errorId : undefined}
        className={[
          'min-h-12 rounded-10 bg-sunken px-3.5 text-16 text-primary',
          error !== null ? 'border border-danger' : 'shadow-ring-quiet',
        ].join(' ')}
        {...rest}
      />
      {error !== null && (
        <p id={errorId} className="text-14 text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
