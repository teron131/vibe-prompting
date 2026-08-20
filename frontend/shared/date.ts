/** Owns the shared local date-time presentation used across prompt and evaluation screens. */

const localDateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDateTime(value: string): string {
  return localDateTime.format(new Date(value));
}
