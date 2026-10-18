import { Temporal } from "@js-temporal/polyfill";
import { locale } from "../i18n";

export const dateAdd = (date: string, days: number) =>
  Temporal.PlainDate.from(date).add({ days }).toString();

export const todayIn = (tz: string) =>
  Temporal.Now.zonedDateTimeISO(tz).toPlainDate().toString();

export const weekOf = (date: string, start = 1) => {
  const d = Temporal.PlainDate.from(date);
  return d
    .subtract({ days: (d.dayOfWeek - (start === 0 ? 7 : start) + 7) % 7 })
    .toString();
};

export const niceDate = (value: string, tz?: string) =>
  value.length === 10
    ? new Intl.DateTimeFormat(locale(), {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(value + "T12:00:00Z"))
    : new Intl.DateTimeFormat(locale(), {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: tz,
      }).format(new Date(value));

export function validDate(date: string) {
  try {
    Temporal.PlainDate.from(date);
    return true;
  } catch {
    return false;
  }
}

export function localDate(iso: string, tz: string) {
  return Temporal.Instant.from(iso)
    .toZonedDateTimeISO(tz)
    .toPlainDate()
    .toString();
}
