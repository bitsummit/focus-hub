import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localDate,periodStart,periodBounds,addDays} from '../server/calendar.ts';
test('10: Europe/Madrid local days cross UTC midnight and support an editable timezone',()=>{
 assert.equal(localDate('Europe/Madrid','2026-10-15T22:30:00Z'),'2026-10-16');
 assert.equal(localDate('America/New_York','2026-10-16T00:30:00Z'),'2026-10-15');
 assert.equal(periodStart('2026-10-18','weekly'),'2026-10-12');
 assert.equal(periodStart('2026-10-18','weekly',0),'2026-10-18');
 assert.equal(addDays('2026-12-31',1),'2027-01-01');
});
test('10: calendar ranges include DST 23/25-hour days rather than assuming UTC 24-hour windows',()=>{
 const spring=periodBounds('2026-03-29','2026-03-30','Europe/Madrid');
 const fall=periodBounds('2026-10-25','2026-10-26','Europe/Madrid');
 assert.equal(Date.parse(spring.end)-Date.parse(spring.start),23*3600000);
 assert.equal(Date.parse(fall.end)-Date.parse(fall.start),25*3600000);
 assert.equal(spring.start,'2026-03-28T23:00:00.000Z');
 assert.equal(fall.end,'2026-10-25T23:00:00.000Z');
});
