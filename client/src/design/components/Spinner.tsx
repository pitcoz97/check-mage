/** Indicatore di attesa. La rotazione si ferma con `prefers-reduced-motion` (global.css). */
export function Spinner({ label }: { label: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-3 text-muted">
      <span aria-hidden="true" className="size-6 animate-spin rounded-full border-2 border-subtle border-t-gold" />
      <span>{label}</span>
    </span>
  );
}
