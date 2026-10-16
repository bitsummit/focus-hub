import { Temporal } from '@js-temporal/polyfill';

/** Calendar arithmetic deliberately uses local dates rather than 24-hour offsets. */
export function localDate(timezone:string, instant:string|Date = new Date()):string {
 const value = instant instanceof Date ? instant.toISOString() : instant;
 return Temporal.Instant.from(value).toZonedDateTimeISO(timezone).toPlainDate().toString();
}
export function addDays(date:string, amount:number):string {
 return Temporal.PlainDate.from(date).add({days:amount}).toString();
}
export function periodStart(date:string, type:'daily'|'weekly', weekStart=1):string {
 const day = Temporal.PlainDate.from(date);
 if(type==='daily') return day.toString();
 const weekday = day.dayOfWeek % 7;
 return day.subtract({days:(weekday-weekStart+7)%7}).toString();
}
export function periodBounds(start:string,end:string,timezone:string):{start:string;end:string} {
 return {
  start:Temporal.PlainDate.from(start).toZonedDateTime({timeZone:timezone,plainTime:'00:00'}).toInstant().toString({smallestUnit:'millisecond'}),
  end:Temporal.PlainDate.from(end).toZonedDateTime({timeZone:timezone,plainTime:'00:00'}).toInstant().toString({smallestUnit:'millisecond'}),
 };
}
