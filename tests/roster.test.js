/*
 * Unit tests for the roster maths.
 *   node --test tests/
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Roster = require("../roster.js");

const d = (iso) => Roster.fromISO(iso);

test("7/7 cycles from the anchor date", () => {
  const pattern = Roster.normalisePattern({ id: "7-7", onsite: 7, off: 7, anchor: "2026-01-05" });
  assert.equal(pattern.cycle, 14);

  const days = Roster.range(d("2026-01-05"), d("2026-01-19")).map((date) =>
    Roster.describeDay(pattern, date)
  );

  assert.deepEqual(days.slice(0, 7).map((x) => x.onsite), [true, true, true, true, true, true, true]);
  assert.deepEqual(days.slice(7, 14).map((x) => x.onsite), [false, false, false, false, false, false, false]);
  assert.equal(days[0].isFlyIn, true);
  assert.equal(days[6].isFlyOut, true);
  assert.equal(days[6].dayOfSwing, 7);
  assert.equal(days[7].dayOfBreak, 1);
  assert.equal(days[13].dayOfBreak, 7);
  assert.equal(days[14].isFlyIn, true, "cycle restarts on day 15");
  assert.equal(days[14].swing, 2);
});

test("8/6 keeps the swing boundary on an 14 day cycle", () => {
  const pattern = Roster.normalisePattern({ id: "8-6", onsite: 8, off: 6, anchor: "2026-03-02" });
  const flyIn = d("2026-03-02");
  const flyOut = Roster.addDays(flyIn, 7);

  assert.equal(Roster.describeDay(pattern, flyIn).isFlyIn, true);
  assert.equal(Roster.describeDay(pattern, flyOut).isFlyOut, true);
  assert.equal(Roster.describeDay(pattern, Roster.addDays(flyOut, 1)).onsite, false);
  assert.equal(Roster.describeDay(pattern, Roster.addDays(flyIn, 14)).isFlyIn, true);
  assert.equal(Roster.describeDay(pattern, Roster.addDays(flyIn, 14)).swing, 2);
});

test("2/2 short swing rolls continuously", () => {
  const pattern = Roster.normalisePattern({ id: "2-2", onsite: 2, off: 2, anchor: "2026-06-01" });
  const types = Roster.range(d("2026-06-01"), d("2026-06-08")).map((x) =>
    Roster.describeDay(pattern, x).type
  );
  assert.deepEqual(types, ["onsite", "onsite", "home", "home", "onsite", "onsite", "home", "home"]);
});

test("the cycle runs backwards before the anchor date", () => {
  const pattern = Roster.normalisePattern({ id: "14-7", onsite: 14, off: 7, anchor: "2026-01-01" });
  const before = Roster.describeDay(pattern, d("2025-12-31"));
  assert.equal(before.onsite, false, "day before the anchor is the last R&R day");
  assert.equal(before.dayOfBreak, 7);
  assert.equal(before.swing, 0);
  const back = Roster.describeDay(pattern, d("2025-12-11"));
  assert.equal(back.isFlyIn, true, "one full cycle before the anchor is a fly-in day");
  assert.equal(back.swing, 0);
  const midBack = Roster.describeDay(pattern, d("2025-12-18"));
  assert.equal(midBack.onsite, true, "day 8 of the swing before the anchor");
  assert.equal(midBack.dayOfSwing, 8);
});

test("date maths ignores daylight saving", () => {
  // Sydney DST ends 5 April 2026 — a naive ms/86400000 diff gives 30.958 days.
  assert.equal(Roster.diffDays(d("2026-03-29"), d("2026-04-28")), 30);
  assert.equal(Roster.diffDays(d("2026-04-05"), d("2026-04-06")), 1);
});

test("shift rotation alternates day and night swings", () => {
  const pattern = Roster.normalisePattern({ id: "7-7", onsite: 7, off: 7, anchor: "2026-01-05", shift: "rotate" });
  const swing1 = Roster.describeDay(pattern, d("2026-01-05"));
  const swing2 = Roster.describeDay(pattern, d("2026-01-19"));
  const swing3 = Roster.describeDay(pattern, d("2026-02-02"));
  assert.equal(swing1.shift, "day");
  assert.equal(swing2.shift, "night");
  assert.equal(swing3.shift, "day");
});

test("fly-out day can be treated as travel home", () => {
  const pattern = Roster.normalisePattern({
    id: "8-6", onsite: 8, off: 6, anchor: "2026-03-02", flyOutAsHome: true
  });
  const flyOut = Roster.describeDay(pattern, d("2026-03-09"));
  assert.equal(flyOut.isFlyOut, true);
  assert.equal(flyOut.onsite, false);
  assert.equal(flyOut.type, "home");
  assert.equal(flyOut.dayOfBreak, 1);
  assert.equal(flyOut.daysOfBreak, 7, "the extra travel-home day extends the break");
});

test("weekly pay lands every 7 days from the pay anchor", () => {
  const pay = Roster.normalisePay({ freq: "weekly", anchor: "2026-01-08" });
  // 1 Jan is part of the weekly series running backwards from the anchor.
  const days = Roster.paydaysInRange(pay, d("2026-01-01"), d("2026-01-31")).map(Roster.toISO);
  assert.deepEqual(days, ["2026-01-01", "2026-01-08", "2026-01-15", "2026-01-22", "2026-01-29"]);
  assert.deepEqual(
    Roster.paydaysInRange(pay, d("2026-01-05"), d("2026-01-31")).map(Roster.toISO),
    ["2026-01-08", "2026-01-15", "2026-01-22", "2026-01-29"]
  );
});

test("fortnightly pay skips nothing across a month boundary", () => {
  const pay = Roster.normalisePay({ freq: "fortnightly", anchor: "2026-01-01" });
  const days = Roster.paydaysInRange(pay, d("2026-01-01"), d("2026-03-01")).map(Roster.toISO);
  assert.deepEqual(days, ["2026-01-01", "2026-01-15", "2026-01-29", "2026-02-12", "2026-02-26"]);
});

test("monthly pay clamps short months to the last day", () => {
  const pay = Roster.normalisePay({ freq: "monthly", anchor: "2026-01-31" });
  const days = Roster.paydaysInRange(pay, d("2026-01-01"), d("2026-04-30")).map(Roster.toISO);
  assert.deepEqual(days, ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
});

test("twice monthly and last-day pay", () => {
  const twice = Roster.normalisePay({ freq: "twice", anchor: "2026-01-01" });
  assert.deepEqual(
    Roster.paydaysInRange(twice, d("2026-02-01"), d("2026-02-28")).map(Roster.toISO),
    ["2026-02-01", "2026-02-15"]
  );
  const last = Roster.normalisePay({ freq: "last", anchor: "2026-01-01" });
  assert.deepEqual(
    Roster.paydaysInRange(last, d("2026-02-01"), d("2026-02-28")).map(Roster.toISO),
    ["2026-02-28"]
  );
});

test("custom every-N-days pay", () => {
  const pay = Roster.normalisePay({ freq: "custom", every: 10, anchor: "2026-05-01" });
  assert.deepEqual(
    Roster.paydaysInRange(pay, d("2026-05-01"), d("2026-05-31")).map(Roster.toISO),
    ["2026-05-01", "2026-05-11", "2026-05-21", "2026-05-31"]
  );
});

test("nextPayday looks forward from a date", () => {
  const pay = Roster.normalisePay({ freq: "fortnightly", anchor: "2026-01-01" });
  assert.equal(Roster.toISO(Roster.nextPayday(pay, d("2026-01-16"))), "2026-01-29");
  assert.equal(Roster.toISO(Roster.nextPayday(pay, d("2026-01-15"), true)), "2026-01-15");
});

test("swingsInRange lists every swing touching the window", () => {
  const pattern = Roster.normalisePattern({ id: "7-7", onsite: 7, off: 7, anchor: "2026-01-05" });
  const swings = Roster.swingsInRange(pattern, d("2026-01-01"), d("2026-02-28"));
  assert.equal(swings.length, 4);
  assert.deepEqual(swings.map((s) => Roster.toISO(s.flyIn)), [
    "2026-01-05", "2026-01-19", "2026-02-02", "2026-02-16"
  ]);
  assert.deepEqual(swings.map((s) => Roster.toISO(s.flyOut)), [
    "2026-01-11", "2026-01-25", "2026-02-08", "2026-02-22"
  ]);
  assert.equal(swings[0].number, 1);
  assert.equal(swings[3].days, 7);
});

test("swingsInRange handles a swing that straddles the window edge", () => {
  const pattern = Roster.normalisePattern({ id: "14-7", onsite: 14, off: 7, anchor: "2026-01-01" });
  const swings = Roster.swingsInRange(pattern, d("2026-01-10"), d("2026-01-12"));
  assert.equal(swings.length, 1, "a swing starting before the window is still included");
  assert.equal(Roster.toISO(swings[0].flyIn), "2026-01-01");
});

test("nextFlyIn counts from the cycle, not from today's status", () => {
  const pattern = Roster.normalisePattern({ id: "8-6", onsite: 8, off: 6, anchor: "2026-03-02" });
  assert.equal(Roster.toISO(Roster.nextFlyIn(pattern, d("2026-03-05"))), "2026-03-16");
  assert.equal(Roster.toISO(Roster.nextFlyIn(pattern, d("2026-03-02"), true)), "2026-03-02");
});

test("summarise totals a calendar month", () => {
  const pattern = Roster.normalisePattern({ id: "7-7", onsite: 7, off: 7, anchor: "2026-01-05" });
  const pay = Roster.normalisePay({ freq: "fortnightly", anchor: "2026-01-08" });
  const stats = Roster.summarise(pattern, pay, d("2026-01-01"), d("2026-01-31"));
  assert.equal(stats.days, 31);
  assert.equal(stats.onsite, 14);   // 5-11 and 19-25
  assert.equal(stats.home, 17);     // 1-4 (tail of the previous break) + 12-18 + 26-31
  assert.equal(stats.swings, 2);    // fly-in days inside January
  assert.equal(stats.flights, 4);
  assert.equal(stats.paydays, 2);   // 8 and 22
  assert.equal(stats.onsite + stats.home, 31);
});

test("homePercent matches the pattern", () => {
  assert.equal(Roster.homePercent({ onsite: 8, off: 6 }), 42.9);
  assert.equal(Roster.homePercent({ onsite: 7, off: 7 }), 50);
});

test("week start shifts the calendar grid", () => {
  // 2026-08-01 is a Saturday.
  assert.equal(Roster.toISO(Roster.startOfWeek(d("2026-08-05"), 1)), "2026-08-03"); // Monday
  assert.equal(Roster.toISO(Roster.startOfWeek(d("2026-08-05"), 0)), "2026-08-02"); // Sunday
  assert.deepEqual(Roster.weekdayInitials(1), ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);
});

test("garbage input is coerced, never thrown", () => {
  const pattern = Roster.normalisePattern({ onsite: "abc", off: null, anchor: "nope", shift: "spaceship" });
  assert.equal(pattern.onsite, 7);
  assert.equal(pattern.off, 7);
  assert.equal(pattern.shift, "day");
  assert.match(pattern.anchor, /^\d{4}-\d{2}-\d{2}$/);
  const day = Roster.describeDay(pattern, Roster.today());
  assert.ok(day.type === "onsite" || day.type === "home");
});

test("leap day is handled", () => {
  assert.equal(Roster.daysInMonth(2028, 1), 29);
  const pay = Roster.normalisePay({ freq: "last", anchor: "2028-01-01" });
  assert.equal(Roster.toISO(Roster.paydaysInRange(pay, d("2028-02-01"), d("2028-02-29"))[0]), "2028-02-29");
});
