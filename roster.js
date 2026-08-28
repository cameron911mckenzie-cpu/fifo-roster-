/*
 * roster.js
 * Pure roster maths for the FIFO Roster planner.
 *
 * Everything in here is deterministic and free of DOM access so it can be
 * unit tested in node (see tests/roster.test.js) and reused by app.js.
 *
 * A roster is an endless cycle: `onsite` days at site, then `off` days at
 * home, repeated forever in both directions from an anchor date. The anchor
 * date is always day 1 of a swing (the fly-in day). Cycle length is
 * onsite + off.
 */
(function (global) {
  "use strict";

  var MS_DAY = 86400000;

  var MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  var MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  /* ---------------------------------------------------------------- dates */

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  // Local calendar date from a YYYY-MM-DD string (never UTC — avoids the
  // classic "my roster is one day out" bug west of Greenwich).
  function fromISO(iso) {
    var parts = String(iso || "").split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function toISO(date) {
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
  }

  function today() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function addDays(date, n) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
  }

  function addMonths(date, n) {
    return new Date(date.getFullYear(), date.getMonth() + n, 1);
  }

  function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }

  function endOfMonth(date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0); }

  function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }

  // Whole days between two dates, immune to daylight saving offsets because
  // both dates are normalised to a UTC midnight stamp first.
  function stamp(date) { return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()); }

  function diffDays(from, to) { return Math.round((stamp(to) - stamp(from)) / MS_DAY); }

  function mod(n, m) { return ((n % m) + m) % m; }

  function isSameDay(a, b) { return !!a && !!b && stamp(a) === stamp(b); }

  function startOfWeek(date, weekStart) {
    return addDays(date, -mod(date.getDay() - (weekStart || 0), 7));
  }

  function isWeekend(date) { return date.getDay() === 0 || date.getDay() === 6; }

  function monthLabel(date) { return MONTHS[date.getMonth()] + " " + date.getFullYear(); }

  function longDateLabel(date) {
    return WEEKDAYS[date.getDay()] + " " + date.getDate() + " " + MONTHS[date.getMonth()] + " " + date.getFullYear();
  }

  function shortDateLabel(date) {
    return WEEKDAYS_SHORT[date.getDay()] + " " + date.getDate() + " " + MONTHS_SHORT[date.getMonth()];
  }

  function weekdayInitials(weekStart) {
    var out = [];
    for (var i = 0; i < 7; i++) out.push(WEEKDAYS_SHORT[mod((weekStart || 0) + i, 7)].slice(0, 2));
    return out;
  }

  // Inclusive list of dates between two dates.
  function range(start, end) {
    var out = [];
    var cursor = start;
    var guard = 0;
    while (stamp(cursor) <= stamp(end) && guard++ < 5000) {
      out.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return out;
  }

  function clampInt(value, min, max, fallback) {
    var n = parseInt(value, 10);
    if (isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  /* -------------------------------------------------------------- presets */

  var PRESETS = [
    { id: "2-2", label: "2/2", onsite: 2, off: 2, note: "Short swing" },
    { id: "4-3", label: "4/3", onsite: 4, off: 3, note: "Week on, week about" },
    { id: "5-2", label: "5/2", onsite: 5, off: 2, note: "Drive-in / residential" },
    { id: "7-7", label: "7/7", onsite: 7, off: 7, note: "Even time" },
    { id: "8-6", label: "8/6", onsite: 8, off: 6, note: "Standard swing" },
    { id: "9-5", label: "9/5", onsite: 9, off: 5, note: "Long days" },
    { id: "10-4", label: "10/4", onsite: 10, off: 4, note: "Compressed" },
    { id: "14-7", label: "14/7", onsite: 14, off: 7, note: "Fortnight on" },
    { id: "14-14", label: "14/14", onsite: 14, off: 14, note: "Even time, long" },
    { id: "21-7", label: "21/7", onsite: 21, off: 7, note: "Extended swing" },
    { id: "28-28", label: "28/28", onsite: 28, off: 28, note: "International" },
    { id: "custom", label: "Custom", onsite: 7, off: 7, note: "Set your own" }
  ];

  var PAY_FREQUENCIES = [
    { id: "weekly", label: "Weekly", steps: 7 },
    { id: "fortnightly", label: "Fortnightly", steps: 14 },
    { id: "fourweekly", label: "Every 4 weeks", steps: 28 },
    { id: "monthly", label: "Monthly · same date", steps: 0 },
    { id: "last", label: "Monthly · last day", steps: 0 },
    { id: "twice", label: "Twice monthly · 1st & 15th", steps: 0 },
    { id: "custom", label: "Every N days", steps: 0 }
  ];

  /* -------------------------------------------------------------- pattern */

  /**
   * Coerce anything the UI (or a shared URL) hands us into a safe pattern.
   * @returns {{id:string,label:string,onsite:number,off:number,cycle:number,
   *            anchor:string,shift:string,flyOutAsHome:boolean}}
   */
  function normalisePattern(input) {
    var p = input || {};
    var onsite = clampInt(p.onsite, 1, 120, 7);
    var off = clampInt(p.off, 1, 120, 7);
    var anchor = /^\d{4}-\d{2}-\d{2}$/.test(p.anchor) ? p.anchor : toISO(today());
    var preset = PRESETS.filter(function (item) { return item.id === p.id; })[0];
    var matchingPreset = PRESETS.filter(function (item) {
      return item.id !== "custom" && item.onsite === onsite && item.off === off;
    })[0];
    var id = preset ? preset.id : (matchingPreset ? matchingPreset.id : "custom");
    var shift = p.shift === "night" || p.shift === "rotate" ? p.shift : "day";
    return {
      id: id,
      label: id === "custom" ? onsite + "/" + off : matchingPreset ? matchingPreset.label : onsite + "/" + off,
      onsite: onsite,
      off: off,
      cycle: onsite + off,
      anchor: anchor,
      shift: shift,
      flyOutAsHome: p.flyOutAsHome === true
    };
  }

  function homePercent(pattern) {
    var p = normalisePattern(pattern);
    return Math.round((p.off / p.cycle) * 1000) / 10;
  }

  /**
   * Everything the calendar needs to know about a single date.
   */
  function describeDay(pattern, date) {
    var p = normalisePattern(pattern);
    var anchor = fromISO(p.anchor);
    var offset = diffDays(anchor, date);          // may be negative — cycle runs both ways
    var cycleIndex = mod(offset, p.cycle);
    var cycleNumber = Math.floor(offset / p.cycle);
    var isOnsiteSlot = cycleIndex < p.onsite;
    var isFlyIn = isOnsiteSlot && cycleIndex === 0;
    var isFlyOut = isOnsiteSlot && cycleIndex === p.onsite - 1;
    var travelHome = isFlyOut && p.flyOutAsHome;
    var onsite = isOnsiteSlot && !travelHome;
    var swing = cycleNumber + 1;
    var shift = p.shift === "rotate" ? (mod(cycleNumber, 2) === 0 ? "day" : "night") : (p.shift || "day");
    var dayOfSwing = onsite ? cycleIndex + 1 : null;
    var breakLength = p.off + (p.flyOutAsHome ? 1 : 0);
    var dayOfBreak = onsite ? null : (p.flyOutAsHome && isFlyOut ? 1 : cycleIndex - p.onsite + 1);

    return {
      date: date,
      iso: toISO(date),
      onsite: onsite,
      type: onsite ? "onsite" : "home",
      swing: swing,
      cycle: p.cycle,
      dayOfSwing: dayOfSwing,
      daysInSwing: p.onsite,
      dayOfBreak: dayOfBreak,
      daysOfBreak: breakLength,
      isFlyIn: isFlyIn,
      isFlyOut: isFlyOut,
      isTravel: isFlyIn || isFlyOut,
      shift: shift,
      cycleIndex: cycleIndex,
      isWeekend: isWeekend(date)
    };
  }

  function shortStatus(day) {
    if (day.isFlyIn) return "Fly in";
    if (day.isFlyOut) return day.onsite ? "Fly out" : "Travel home";
    return day.onsite ? "Onsite" : "Home";
  }

  /* ---------------------------------------------------------------- swings */

  /**
   * Every swing that overlaps [start, end], in order.
   */
  function swingsInRange(pattern, start, end) {
    var p = normalisePattern(pattern);
    var anchor = fromISO(p.anchor);
    var firstCycle = Math.floor(diffDays(anchor, start) / p.cycle) - 1;
    var lastCycle = Math.floor(diffDays(anchor, end) / p.cycle) + 1;
    var out = [];
    for (var c = firstCycle; c <= lastCycle; c++) {
      var flyIn = addDays(anchor, c * p.cycle);
      var flyOut = addDays(flyIn, p.onsite - 1);
      if (stamp(flyOut) < stamp(start) || stamp(flyIn) > stamp(end)) continue;
      var shift = p.shift === "rotate" ? (mod(c, 2) === 0 ? "day" : "night") : p.shift;
      out.push({
        number: c + 1,
        flyIn: flyIn,
        flyOut: flyOut,
        days: p.onsite,
        shift: shift,
        breakDays: p.off,
        breakEnds: addDays(flyOut, p.off + 1),
        nextFlyIn: addDays(flyIn, p.cycle)
      });
    }
    return out;
  }

  function currentSwing(pattern, date) {
    var day = describeDay(pattern, date);
    var list = swingsInRange(pattern, addDays(date, -day.cycle), addDays(date, day.cycle));
    return list.filter(function (s) { return s.number === day.swing; })[0] || null;
  }

  function nextFlyIn(pattern, from, inclusive) {
    var p = normalisePattern(pattern);
    var anchor = fromISO(p.anchor);
    var base = from || today();
    var d = diffDays(anchor, base);
    if (inclusive && mod(d, p.cycle) === 0) return base;
    var next = Math.ceil((d + (inclusive ? 0 : 1)) / p.cycle);
    return addDays(anchor, next * p.cycle);
  }

  /* ------------------------------------------------------------------- pay */

  function normalisePay(input) {
    var p = input || {};
    var freq = PAY_FREQUENCIES.filter(function (item) { return item.id === p.freq; })[0] || PAY_FREQUENCIES[1];
    return {
      freq: freq.id,
      label: freq.label,
      anchor: /^\d{4}-\d{2}-\d{2}$/.test(p.anchor) ? p.anchor : toISO(today()),
      every: clampInt(p.every, 1, 365, 28),
      amount: typeof p.amount === "number" && isFinite(p.amount) ? p.amount : null
    };
  }

  function paydaysInRange(pay, start, end) {
    var cfg = normalisePay(pay);
    var out = [];
    var anchor = fromISO(cfg.anchor);
    var cursor;

    if (cfg.freq === "weekly" || cfg.freq === "fortnightly" || cfg.freq === "fourweekly" || cfg.freq === "custom") {
      var step = cfg.freq === "custom" ? cfg.every
        : (PAY_FREQUENCIES.filter(function (f) { return f.id === cfg.freq; })[0] || {}).steps || 14;
      var d0 = diffDays(anchor, start);
      var k = Math.ceil(d0 / step);
      cursor = addDays(anchor, k * step);
      var guard = 0;
      while (stamp(cursor) <= stamp(end) && guard++ < 2000) {
        out.push(cursor);
        cursor = addDays(cursor, step);
      }
      return out;
    }

    var months = startOfMonth(start);
    var last = endOfMonth(end);
    var guard2 = 0;
    while (stamp(months) <= stamp(last) && guard2++ < 1200) {
      var y = months.getFullYear();
      var m = months.getMonth();
      var dim = daysInMonth(y, m);
      var candidates = [];
      if (cfg.freq === "monthly") {
        candidates.push(new Date(y, m, Math.min(anchor.getDate(), dim)));
      } else if (cfg.freq === "last") {
        candidates.push(new Date(y, m, dim));
      } else if (cfg.freq === "twice") {
        candidates.push(new Date(y, m, 1), new Date(y, m, 15));
      }
      candidates.forEach(function (candidate) {
        if (stamp(candidate) >= stamp(start) && stamp(candidate) <= stamp(end)) out.push(candidate);
      });
      months = addMonths(months, 1);
    }
    return out;
  }

  function nextPayday(pay, from, inclusive) {
    var cfg = normalisePay(pay);
    var base = from || today();
    var window = paydaysInRange(cfg, addDays(base, inclusive ? 0 : 1), addDays(base, 800));
    return window.length ? window[0] : null;
  }

  function payLabel(pay) {
    var cfg = normalisePay(pay);
    if (cfg.freq === "custom") return "Every " + cfg.every + " days";
    var found = PAY_FREQUENCIES.filter(function (f) { return f.id === cfg.freq; })[0];
    return found ? found.label : cfg.freq;
  }

  /* ----------------------------------------------------------------- stats */

  /**
   * Roll-up for an inclusive date range.
   */
  function summarise(pattern, pay, start, end) {
    var days = range(start, end);
    var onsite = 0, home = 0, swings = 0, flights = 0, paydays = 0, nights = 0, weekendsWorked = 0;
    var lastSwing = null;
    var paySet = {};
    paydaysInRange(pay, start, end).forEach(function (d) { paySet[toISO(d)] = true; });

    days.forEach(function (date) {
      var day = describeDay(pattern, date);
      if (day.onsite) {
        onsite++;
        if (day.shift === "night") nights++;
        if (day.isWeekend) weekendsWorked++;
        if (day.isFlyIn) { swings++; flights++; }
        if (day.isFlyOut) flights++;
      } else {
        home++;
      }
      lastSwing = day.swing;
      if (paySet[day.iso]) paydays++;
    });

    var total = days.length || 1;
    return {
      start: start,
      end: end,
      days: days.length,
      onsite: onsite,
      home: home,
      homePercent: Math.round((home / total) * 1000) / 10,
      swings: swings,
      flights: flights,
      paydays: paydays,
      nights: nights,
      weekendsWorked: weekendsWorked,
      lastSwing: lastSwing
    };
  }

  /* --------------------------------------------------------------- export */

  function api() {
    return {
      MONTHS: MONTHS,
      MONTHS_SHORT: MONTHS_SHORT,
      WEEKDAYS: WEEKDAYS,
      WEEKDAYS_SHORT: WEEKDAYS_SHORT,
      PRESETS: PRESETS,
      PAY_FREQUENCIES: PAY_FREQUENCIES,
      pad2: pad2,
      fromISO: fromISO,
      toISO: toISO,
      today: today,
      addDays: addDays,
      addMonths: addMonths,
      startOfMonth: startOfMonth,
      endOfMonth: endOfMonth,
      startOfWeek: startOfWeek,
      diffDays: diffDays,
      mod: mod,
      isSameDay: isSameDay,
      isWeekend: isWeekend,
      daysInMonth: daysInMonth,
      monthLabel: monthLabel,
      longDateLabel: longDateLabel,
      shortDateLabel: shortDateLabel,
      weekdayInitials: weekdayInitials,
      range: range,
      clampInt: clampInt,
      normalisePattern: normalisePattern,
      normalisePay: normalisePay,
      describeDay: describeDay,
      shortStatus: shortStatus,
      swingsInRange: swingsInRange,
      currentSwing: currentSwing,
      nextFlyIn: nextFlyIn,
      paydaysInRange: paydaysInRange,
      nextPayday: nextPayday,
      payLabel: payLabel,
      summarise: summarise,
      homePercent: homePercent
    };
  }

  var Roster = api();
  global.Roster = Roster;
  if (typeof module !== "undefined" && module.exports) module.exports = Roster;
}(typeof window !== "undefined" ? window : globalThis));
