function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function dateOnly(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dateTimeAt(offsetDays: number, time: string): string {
  return `${dateOnly(offsetDays)} ${time}:00`;
}
