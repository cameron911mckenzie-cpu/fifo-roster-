/*
 * SWING · FIFO Roster Planner
 *
 * app.js wires the sidebar controls, the calendar views, the day drawer and
 * the export / share actions on top of the pure maths in roster.js.
 *
 * The whole app state is a single plain object: it is persisted to
 * localStorage, encoded into the URL for sharing, and re-rendered from
 * scratch on every change. There is no framework and no build step.
 */
(function () {
  "use strict";

  var R = window.Roster;
  var STORE_KEY = "swing-roster-v1";

  /* ---------------------------------------------------------------- state */

  function defaults() {
    var today = R.today();
    var monday = R.addDays(today, -R.mod(today.getDay() - 1, 7));
    return {
      preset: "8-6",
      onsite: 8,
      off: 6,
      anchor: R.toISO(monday),               // day 1 of a swing
      shift: "day",                          // day | night | rotate
      flyOutAsHome: false,
      payFreq: "fortnightly",
      payAnchor: R.toISO(R.addDays(monday, -14)),
      payEvery: 28,
      payAmount: null,
      weekStart: 1,                          // 1 = Monday, 0 = Sunday
      showNotes: true,
      showPay: true,
      showOutside: true,
      view: "month",                         // month | quarter | year
      cursor: R.toISO(R.startOfMonth(today)),
      notes: {}
    };
  }

  var state = defaults();
  var selectedISO = null;
  var dayCache = {};   // iso -> describeDay, rebuilt per render
  var payCache = {};   // iso -> true

  function pattern() {
    return R.normalisePattern({
      id: state.preset,
      onsite: state.onsite,
      off: state.off,
      anchor: state.anchor,
      shift: state.shift,
      flyOutAsHome: state.flyOutAsHome
    });
  }

  function payConfig() {
    return R.normalisePay({
      freq: state.payFreq,
      anchor: state.payAnchor,
      every: state.payEvery,
      amount: state.payAmount
    });
  }

  function setState(patch) {
    Object.keys(patch).forEach(function (key) { state[key] = patch[key]; });
    save();
    render();
  }

  /* ----------------------------------------------------------- persistence */

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
    var query = toQuery();
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, "", query ? "?" + query : window.location.pathname);
    }
  }

  function load() {
    var stored = null;
    try { stored = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { stored = null; }
    if (stored && typeof stored === "object") {
      Object.keys(defaults()).forEach(function (key) {
        if (stored[key] !== undefined && stored[key] !== null) state[key] = stored[key];
      });
    }
    applyQuery(window.location.search);
    // keep the calendar on the month containing the anchor when it is closed
    state.cursor = /^\d{4}-\d{2}-\d{2}$/.test(state.cursor) ? state.cursor : R.toISO(R.startOfMonth(R.today()));
  }

  function toQuery() {
    var parts = [];
    parts.push("r=" + state.onsite + "-" + state.off);
    parts.push("a=" + state.anchor);
    if (state.shift !== "day") parts.push("s=" + state.shift);
    if (state.flyOutAsHome) parts.push("t=h");
    if (state.payFreq !== "fortnightly") parts.push("pf=" + state.payFreq);
    parts.push("pa=" + state.payAnchor);
    if (state.payFreq === "custom") parts.push("pe=" + state.payEvery);
    if (state.payAmount !== null && state.payAmount !== "") parts.push("am=" + state.payAmount);
    if (Number(state.weekStart) !== 1) parts.push("w=0");
    if (state.view !== "month") parts.push("v=" + state.view);
    return parts.join("&");
  }

  function applyQuery(search) {
    if (!search) return false;
    var q = new URLSearchParams(search);
    if (!q.toString()) return false;
    var r = (q.get("r") || "").split("-");
    if (r.length === 2) {
      state.onsite = R.clampInt(r[0], 1, 120, state.onsite);
      state.off = R.clampInt(r[1], 1, 120, state.off);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.get("a") || "")) state.anchor = q.get("a");
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.get("pa") || "")) state.payAnchor = q.get("pa");
    if (["day", "night", "rotate"].indexOf(q.get("s")) >= 0) state.shift = q.get("s");
    state.flyOutAsHome = q.get("t") === "h";
    if (q.get("pf")) state.payFreq = q.get("pf");
    if (q.get("pe")) state.payEvery = R.clampInt(q.get("pe"), 1, 365, 28);
    if (q.get("am") !== null) state.payAmount = parseFloat(q.get("am")) || null;
    if (q.get("w") !== null) state.weekStart = q.get("w") === "0" ? 0 : 1;
    if (["month", "quarter", "year"].indexOf(q.get("v")) >= 0) state.view = q.get("v");
    syncPresetFromNumbers();
    return true;
  }

  function syncPresetFromNumbers() {
    var match = R.PRESETS.filter(function (p) {
      return p.id !== "custom" && p.onsite === state.onsite && p.off === state.off;
    })[0];
    state.preset = match ? match.id : "custom";
  }

  /* ---------------------------------------------------------------- utils */

  function $(id) { return document.getElementById(id); }

  function escapeHtml(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function money(value) {
    var n = Number(value);
    if (!isFinite(n)) return "—";
    return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function countdown(days) {
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    return "in " + days + " days";
  }

  function countdownShort(days) {
    if (days === 0) return "Today";
    if (days === 1) return "1 day";
    return days + " days";
  }

  var toastTimer = null;
  function toast(message) {
    var stack = $("toastStack");
    var node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    stack.appendChild(node);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      node.remove();
    }, 2800);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        var ok = document.execCommand("copy");
        ta.remove();
        ok ? resolve() : reject(new Error("copy failed"));
      } catch (e) {
        ta.remove();
        reject(e);
      }
    });
  }

  /* --------------------------------------------------------- day metadata */

  function buildCaches(start, end) {
    dayCache = {};
    payCache = {};
    var pat = pattern();
    R.range(start, end).forEach(function (date) {
      dayCache[R.toISO(date)] = R.describeDay(pat, date);
    });
    R.paydaysInRange(payConfig(), start, end).forEach(function (date) {
      payCache[R.toISO(date)] = true;
    });
  }

  function infoFor(date) {
    return dayCache[R.toISO(date)] || R.describeDay(pattern(), date);
  }

  function isPayDay(date) { return payCache[R.toISO(date)] === true; }

  function visibleRange() {
    var cursor = R.fromISO(state.cursor);
    if (state.view === "year") {
      return { start: new Date(cursor.getFullYear(), 0, 1), end: new Date(cursor.getFullYear(), 11, 31) };
    }
    if (state.view === "quarter") {
      return { start: R.startOfMonth(cursor), end: R.endOfMonth(R.addMonths(cursor, 2)) };
    }
    var monthStart = R.startOfMonth(cursor);
    return {
      start: state.showOutside ? R.startOfWeek(monthStart, state.weekStart) : monthStart,
      end: state.showOutside ? R.addDays(R.startOfWeek(R.endOfMonth(cursor), state.weekStart), 6) : R.endOfMonth(cursor)
    };
  }

  function statusText(day) {
    if (day.isFlyIn) return "Fly in";
    if (day.isFlyOut) return day.onsite ? "Fly out" : "Travel home";
    return day.onsite ? "Onsite" : "Home";
  }

  // Swings are numbered from the anchor date, so browsing back past it
  // produces zero and negative numbers. Label those honestly.
  function swingLabel(number) {
    return number >= 1 ? "#" + number : "before anchor";
  }

  function positionText(day) {
    return day.onsite
      ? "Day " + day.dayOfSwing + " of " + day.daysInSwing
      : "R&R day " + day.dayOfBreak + " of " + day.daysOfBreak;
  }

  function dayTitle(day) {
    var lines = [
      R.longDateLabel(day.date),
      statusText(day) + " · " + positionText(day),
      "Swing " + day.swing + " · " + (day.shift === "night" ? "Night shift" : "Day shift")
    ];
    if (isPayDay(day.date)) lines.push("Pay day");
    if (state.notes[day.iso]) lines.push("Note: " + state.notes[day.iso]);
    return lines.join("\n");
  }

  /* -------------------------------------------------------------- render */

  function render() {
    syncControls();
    var range = visibleRange();
    buildCaches(range.start, range.end);
    renderPills();
    renderTitle(range);
    renderCalendar(range);
    renderStats(range);
    renderSwings(range);
  }

  function renderPills() {
    var today = R.today();
    var pat = pattern();
    var pay = payConfig();
    var day = R.describeDay(pat, today);

    var todayPill = $("todayPill");
    todayPill.className = "status-pill status-today " + (day.onsite ? "is-onsite" : "is-home");
    if (day.isFlyIn || day.isFlyOut) todayPill.classList.add("is-travel");
    var sub = day.onsite ? (day.swing >= 1 ? "Swing " + day.swing : "Pre-anchor") : "R&R day " + day.dayOfBreak;
    $("todayStatus").innerHTML = statusText(day) + ' <em>· ' + sub + "</em>";
    todayPill.title = R.longDateLabel(today) + " — " + positionText(day);

    var nextIn = R.nextFlyIn(pat, today, true);
    var daysToFlyIn = R.diffDays(today, nextIn);
    var flyPill = $("flyInPill");
    flyPill.className = "status-pill is-travel";
    flyPill.title = "Next fly-in " + R.longDateLabel(nextIn);
    $("nextFlyIn").innerHTML = daysToFlyIn === 0
      ? 'Today <em>· fly in</em>'
      : countdownShort(daysToFlyIn) + ' <em>· ' + R.shortDateLabel(nextIn) + "</em>";

    var homeDate = day.onsite ? findNextHome(pat, today) : today;
    var daysToHome = R.diffDays(today, homeDate);
    var homePill = $("homePill");
    homePill.className = "status-pill is-home";
    homePill.title = "Home from " + R.longDateLabel(homeDate);
    $("nextHome").innerHTML = day.onsite
      ? countdownShort(daysToHome) + ' <em>· ' + R.shortDateLabel(homeDate) + "</em>"
      : 'Now <em>· day ' + day.dayOfBreak + " of " + day.daysOfBreak + "</em>";

    var payDate = R.nextPayday(pay, today, true);
    var payPill = $("payPill");
    payPill.className = "status-pill is-pay";
    payPill.title = payDate ? "Pay day " + R.longDateLabel(payDate) + " — " + R.payLabel(pay) : "No pay day found";
    $("nextPay").innerHTML = payDate
      ? (R.diffDays(today, payDate) === 0
        ? 'Today <em>· ' + (state.payAmount ? money(state.payAmount) : "pay day") + "</em>"
        : countdownShort(R.diffDays(today, payDate)) + ' <em>· ' + R.shortDateLabel(payDate) + "</em>")
      : "—";
  }

  function findNextHome(pat, from) {
    var cursor = from;
    for (var i = 0; i < 200; i++) {
      cursor = R.addDays(cursor, 1);
      if (!R.describeDay(pat, cursor).onsite) return cursor;
    }
    return from;
  }

  function renderTitle(range) {
    var cursor = R.fromISO(state.cursor);
    var title = "";
    var kicker = "";
    if (state.view === "year") {
      title = String(cursor.getFullYear());
      kicker = "Continuous cycle · " + state.onsite + " on / " + state.off + " off · anchored " + R.shortDateLabel(R.fromISO(state.anchor));
    } else if (state.view === "quarter") {
      title = R.MONTHS_SHORT[cursor.getMonth()] + " – " + R.MONTHS_SHORT[R.addMonths(cursor, 2).getMonth()] + " " + cursor.getFullYear();
      kicker = "3 months in pattern";
    } else {
      title = R.monthLabel(cursor);
      kicker = "Cycle " + state.onsite + " + " + state.off + " = " + (state.onsite + state.off) + " days · anchor " + R.shortDateLabel(R.fromISO(state.anchor));
    }
    $("viewTitle").textContent = title;
    $("viewKicker").textContent = kicker;
  }

  /* ------------------------------------------------------------ calendar */

  function renderCalendar(range) {
    var host = $("calendar");
    if (state.view === "year") host.innerHTML = yearView(range);
    else if (state.view === "quarter") host.innerHTML = quarterView(range);
    else host.innerHTML = monthView(range);
  }

  function weekHeadHTML(extraClass) {
    return '<div class="week-head ' + (extraClass || "") + '">' +
      R.weekdayInitials(Number(state.weekStart)).map(function (d, i) {
        var weekend = R.mod(Number(state.weekStart) + i, 7) % 6 === 0;
        return '<span class="' + (weekend ? "is-weekend" : "") + '">' + d + "</span>";
      }).join("") + "</div>";
  }

  function badgesHTML(day, compact) {
    var out = "";
    if (day.isFlyIn) out += '<span class="badge badge-fly"><svg class="icon"><use href="#i-plane" /></svg></span>';
    if (day.isFlyOut) out += '<span class="badge badge-fly out"><svg class="icon"><use href="#i-plane" /></svg></span>';
    if (state.showPay && isPayDay(day.date)) out += '<span class="badge badge-pay"><svg class="icon"><use href="#i-pay" /></svg></span>';
    if (state.showNotes && state.notes[day.iso]) out += '<span class="badge badge-note"><svg class="icon"><use href="#i-note" /></svg></span>';
    if (!compact && R.isSameDay(day.date, R.today())) out += '<span class="badge badge-today">TODAY</span>';
    return out;
  }

  function dayClasses(day, inMonth) {
    var cls = ["day", "day-" + day.type];
    if (day.isFlyIn) cls.push("is-fly-in");
    if (day.isFlyOut) cls.push("is-fly-out");
    if (day.isWeekend) cls.push("is-weekend");
    if (!inMonth) cls.push("is-outside");
    if (R.isSameDay(day.date, R.today())) cls.push("is-today");
    if (selectedISO === day.iso) cls.push("is-selected");
    return cls.join(" ");
  }

  function monthView(range) {
    var cursor = R.fromISO(state.cursor);
    var monthStart = R.startOfMonth(cursor);
    var gridStart = R.startOfWeek(monthStart, Number(state.weekStart));
    var gridEnd = R.addDays(R.startOfWeek(R.endOfMonth(cursor), Number(state.weekStart)), 6);
    var cells = R.range(gridStart, gridEnd).map(function (date) {
      var day = infoFor(date);
      var inMonth = date.getMonth() === cursor.getMonth();
      if (!inMonth && !state.showOutside) {
        return '<div class="day is-outside" style="visibility:hidden"></div>';
      }
      var note = state.notes[day.iso];
      return '<button type="button" class="' + dayClasses(day, inMonth) + '" data-iso="' + day.iso + '" title="' + escapeHtml(dayTitle(day)) + '">' +
        '<span class="day-top"><span class="day-num">' + date.getDate() + "</span>" +
        '<span class="day-badges">' + badgesHTML(day) + "</span></span>" +
        '<span class="day-status">' + statusText(day) + "</span>" +
        '<span class="day-meta">' + positionText(day) +
          (day.onsite ? ' · <span class="day-shift ' + (day.shift === "night" ? "night" : "") + '">' + (day.shift === "night" ? "Night" : "Day") + "</span>" : "") +
        "</span>" +
        (state.showNotes && note ? '<span class="day-note">' + escapeHtml(note) + "</span>" : "") +
        "</button>";
    }).join("");
    return weekHeadHTML() + '<div class="month-grid">' + cells + "</div>";
  }

  function quarterView(range) {
    var cursor = R.fromISO(state.cursor);
    var months = [];
    for (var i = 0; i < 3; i++) {
      var m = R.addMonths(cursor, i);
      months.push(quarterMonthHTML(m));
    }
    return '<div class="quarter-wrap">' + months.join("") + "</div>";
  }

  function quarterMonthHTML(monthDate) {
    var start = R.startOfWeek(R.startOfMonth(monthDate), Number(state.weekStart));
    var end = R.addDays(R.startOfWeek(R.endOfMonth(monthDate), Number(state.weekStart)), 6);
    var cells = R.range(start, end).map(function (date) {
      var day = infoFor(date);
      var inMonth = date.getMonth() === monthDate.getMonth();
      if (!inMonth && !state.showOutside) return '<span class="mini-cell is-outside" style="visibility:hidden"></span>';
      var cls = ["mini-cell", "day-" + day.type];
      if (day.isFlyIn) cls.push("is-fly-in");
      if (day.isFlyOut) cls.push("is-fly-out");
      if (!inMonth) cls.push("is-outside");
      if (R.isSameDay(day.date, R.today())) cls.push("is-today");
      var marks = "";
      if (day.isFlyIn) marks += '<svg class="mini-plane"><use href="#i-plane" /></svg>';
      if (state.showNotes && state.notes[day.iso]) marks += '<i class="mini-dot note"></i>';
      if (state.showPay && isPayDay(day.date)) marks += '<i class="mini-dot"></i>';
      return '<button type="button" class="' + cls.join(" ") + '" data-iso="' + day.iso + '" title="' + escapeHtml(dayTitle(day)) + '">' +
        date.getDate() + marks + "</button>";
    }).join("");
    return '<div class="quarter-month"><h4>' + R.MONTHS[monthDate.getMonth()] + " <em>" + monthDate.getFullYear() + "</em></h4>" +
      '<div class="quarter-grid">' + cells + "</div></div>";
  }

  function yearView(range) {
    var year = R.fromISO(state.cursor).getFullYear();
    var today = R.today();
    var months = [];
    for (var m = 0; m < 12; m++) {
      var monthDate = new Date(year, m, 1);
      var start = R.startOfWeek(monthDate, Number(state.weekStart));
      var end = R.addDays(R.startOfWeek(R.endOfMonth(monthDate), Number(state.weekStart)), 6);
      var onsite = 0, home = 0;
      var cells = R.range(start, end).map(function (date) {
        var day = infoFor(date);
        var inMonth = date.getMonth() === m;
        if (inMonth) { day.onsite ? onsite++ : home++; }
        if (!inMonth) return '<span class="mini-cell is-outside" style="visibility:hidden"></span>';
        var cls = ["mini-cell", "day-" + day.type];
        if (day.isFlyIn) cls.push("is-fly-in");
        if (day.isFlyOut) cls.push("is-fly-out");
        if (R.isSameDay(day.date, today)) cls.push("is-today");
        var marks = "";
        if (day.isFlyIn) marks += '<svg class="mini-plane"><use href="#i-plane" /></svg>';
        if (state.showNotes && state.notes[day.iso]) marks += '<i class="mini-dot note"></i>';
        if (state.showPay && isPayDay(day.date)) marks += '<i class="mini-dot"></i>';
        return '<button type="button" class="' + cls.join(" ") + '" data-iso="' + day.iso + '" title="' + escapeHtml(dayTitle(day)) + '">' +
          date.getDate() + marks + "</button>";
      }).join("");
      var isCurrent = today.getFullYear() === year && today.getMonth() === m;
      months.push(
        '<div class="year-month' + (isCurrent ? " is-current" : "") + '">' +
          "<header><h4 data-jump=\"" + R.toISO(monthDate) + '">' + R.MONTHS[m] + "</h4>" +
          '<span class="year-stat">' + onsite + " on · " + home + " off</span></header>" +
          '<div class="quarter-grid">' + cells + "</div></div>"
      );
    }
    return '<div class="year-wrap">' + months.join("") + "</div>";
  }

  /* --------------------------------------------------------------- stats */

  function renderStats(range) {
    var pat = pattern();
    var stats = R.summarise(pat, payConfig(), range.start, range.end);
    var nextPay = R.nextPayday(payConfig(), R.today(), true);
    var scope = state.view === "year"
      ? "in " + R.fromISO(state.cursor).getFullYear()
      : state.view === "quarter" ? "in view" : "this month";

    var cards = [
      { cls: "onsite", label: "Days onsite", value: stats.onsite, sub: "swing days " + scope },
      { cls: "home", label: "Days home", value: stats.home, sub: "R&R days " + scope },
      {
        cls: "home", label: "Home share",
        value: stats.homePercent + "<small>%</small>",
        sub: "pattern average " + R.homePercent(pat) + "%"
      },
      { cls: "onsite", label: "Swings", value: stats.swings, sub: stats.swings === 1 ? "1 swing starting" : stats.swings + " swings starting" },
      { cls: "travel", label: "Travel days", value: stats.flights, sub: "fly-in and fly-out days" },
      {
        cls: "pay", label: "Pay days",
        value: stats.paydays,
        sub: nextPay ? "next " + R.shortDateLabel(nextPay) : R.payLabel(payConfig())
      }
    ];

    $("statGrid").innerHTML = cards.map(function (card) {
      return '<div class="stat-card ' + card.cls + '">' +
        '<div class="stat-label">' + card.label + "</div>" +
        '<div class="stat-value">' + card.value + "</div>" +
        '<div class="stat-sub">' + escapeHtml(card.sub) + "</div>" +
        "</div>";
    }).join("");
  }

  /* -------------------------------------------------------------- swings */

  function renderSwings(range) {
    var pat = pattern();
    var today = R.today();
    var swings = R.swingsInRange(pat, range.start, range.end);
    var body = $("swingsBody");

    $("swingsTitle").textContent = state.view === "year"
      ? "Swings in " + R.fromISO(state.cursor).getFullYear()
      : state.view === "quarter" ? "Swings in view" : "Swings touching " + R.monthLabel(R.fromISO(state.cursor));
    $("swingsCount").textContent = swings.length + (swings.length === 1 ? " swing" : " swings");

    if (!swings.length) {
      body.innerHTML = '<tr><td colspan="7" style="color:var(--muted-2)">No swings in this range.</td></tr>';
      return;
    }

    body.innerHTML = swings.map(function (swing) {
      var payDays = R.paydaysInRange(payConfig(), swing.flyIn, swing.breakEnds);
      var isNow = R.diffDays(swing.flyIn, today) >= 0 && R.diffDays(today, swing.breakEnds) >= 0;
      var daysAway = R.diffDays(today, swing.flyIn);
      return '<tr class="' + (isNow ? "is-now" : "") + '">' +
        '<td><span class="swing-num">' + swingLabel(swing.number) + "</span>" +
          (isNow ? ' <span class="chip chip-now">Now</span>' : "") + "</td>" +
        '<td class="date-cell">' + R.shortDateLabel(swing.flyIn) +
          "<small>" + (daysAway > 0 ? "in " + daysAway + "d" : daysAway === 0 ? "today" : Math.abs(daysAway) + "d ago") + "</small></td>" +
        '<td class="date-cell">' + R.shortDateLabel(swing.flyOut) + "</td>" +
        "<td>" + swing.days + "</td>" +
        '<td><span class="chip ' + (swing.shift === "night" ? "chip-night" : "chip-day") + '">' + (swing.shift === "night" ? "Nights" : "Days") + "</span></td>" +
        "<td>" + swing.breakDays + " <span style=\"color:var(--muted-2)\">to " + R.shortDateLabel(R.addDays(swing.breakEnds, -1)) + "</span></td>" +
        '<td><span class="pay-dots">' + payDays.map(function () { return "<i></i>"; }).join("") +
          "<span>" + payDays.length + "</span></span></td>" +
        "</tr>";
    }).join("");
  }

  /* ------------------------------------------------------------- sidebar */

  function syncControls() {
    $("presetGrid").innerHTML = R.PRESETS.map(function (preset) {
      var active = state.preset === preset.id ? " active" : "";
      var onsite = preset.id === "custom" ? state.onsite : preset.onsite;
      var off = preset.id === "custom" ? state.off : preset.off;
      return '<button type="button" class="preset' + active + '" data-preset="' + preset.id + '" ' +
        'data-onsite="' + onsite + '" data-off="' + off + '" title="' + preset.note + '">' +
        "<b>" + (preset.id === "custom" ? state.onsite + "/" + state.off : preset.label) + "</b>" +
        "<small>" + preset.note + "</small></button>";
    }).join("");

    $("patternTag").textContent = (state.onsite + state.off) + "-day cycle";
    $("patternSummary").innerHTML = "<b>" + state.onsite + " days on</b> · <b>" + state.off + " days off</b><br>" +
      "Repeat every " + (state.onsite + state.off) + " days · " + R.homePercent(pattern()) + "% of the year at home.<br>" +
      "About " + Math.round(365.25 / (state.onsite + state.off)) + " swings a year.";

    $("customRow").hidden = state.preset !== "custom";
    $("onsiteInput").value = state.onsite;
    $("offInput").value = state.off;
    $("anchorInput").value = state.anchor;
    $("travelSelect").value = state.flyOutAsHome ? "home" : "onsite";

    Array.prototype.forEach.call($("shiftSegmented").children, function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-shift") === state.shift);
    });
    Array.prototype.forEach.call($("weekStartSegmented").children, function (btn) {
      btn.classList.toggle("active", Number(btn.getAttribute("data-week")) === Number(state.weekStart));
    });
    Array.prototype.forEach.call($("viewSwitch").children, function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-view") === state.view);
    });

    $("payFreq").value = state.payFreq;
    $("payEveryRow").hidden = state.payFreq !== "custom";
    $("payEvery").value = state.payEvery;
    $("payAnchor").value = state.payAnchor;
    $("payAmount").value = state.payAmount === null ? "" : state.payAmount;
    $("payTag").textContent = R.payLabel(payConfig());

    $("showNotes").checked = !!state.showNotes;
    $("showPay").checked = !!state.showPay;
    $("showOutside").checked = !!state.showOutside;
  }

  function buildPayOptions() {
    $("payFreq").innerHTML = R.PAY_FREQUENCIES.map(function (freq) {
      return '<option value="' + freq.id + '">' + freq.label + "</option>";
    }).join("");
  }

  /* --------------------------------------------------------------- drawer */

  function openDrawer(iso) {
    var date = R.fromISO(iso);
    var day = R.describeDay(pattern(), date);
    var pat = pattern();
    var today = R.today();
    var pay = payConfig();
    var payToday = R.paydaysInRange(pay, date, date).length > 0;
    var nextPay = R.nextPayday(pay, date, true);
    var swing = R.swingsInRange(pat, R.addDays(date, -pat.cycle), R.addDays(date, pat.cycle))
      .filter(function (s) { return s.number === day.swing; })[0];

    selectedISO = iso;

    $("drawerKicker").textContent = "Swing " + swingLabel(day.swing) + " · " + (day.onsite ? "day " + day.dayOfSwing + " of " + day.daysInSwing : "R&R day " + day.dayOfBreak + " of " + day.daysOfBreak);
    $("drawerDate").textContent = R.longDateLabel(date);

    var bannerCls = day.onsite ? "onsite" : "home";
    $("drawerBody").innerHTML =
      '<div class="status-banner ' + bannerCls + '">' +
        '<svg class="icon"><use href="#' + (day.isTravel ? "i-plane" : day.onsite ? "i-truck" : "i-helmet") + '" /></svg>' +
        "<div><b>" + statusText(day) + "</b><span>" + positionText(day) + " · " +
          (day.shift === "night" ? "Night shift" : "Day shift") + "</span></div>" +
      "</div>" +
      '<ul class="detail-list">' +
        row("Swing number", swingLabel(day.swing), "amber") +
        row("Cycle position", "Day " + (day.cycleIndex + 1) + " of " + day.cycle) +
        row("Roster", state.onsite + " on / " + state.off + " off") +
        row("Cycle anchor", R.shortDateLabel(R.fromISO(state.anchor)), "mono") +
        (swing ? row("Fly in", R.shortDateLabel(swing.flyIn), "mono") : "") +
        (swing ? row("Fly out", R.shortDateLabel(swing.flyOut), "mono") : "") +
        (swing ? row("Back onsite", R.shortDateLabel(swing.nextFlyIn), "mono") : "") +
        row("Days until", R.diffDays(today, date) === 0 ? "That is today" : countdown(Math.abs(R.diffDays(today, date))) + (R.diffDays(today, date) > 0 ? " away" : " ago")) +
        row("Pay day", payToday ? "Yes — today" : (nextPay ? "No — next " + R.shortDateLabel(nextPay) : "—"), payToday ? "gold" : "") +
        (state.payAmount ? row("Pay per cycle", money(state.payAmount), "gold") : "") +
      "</ul>";

    $("drawerNote").value = state.notes[iso] || "";
    $("drawer").hidden = false;
    $("drawerBackdrop").hidden = false;
    render();
    setTimeout(function () { $("drawerNote").focus(); }, 40);
  }

  function row(label, value, cls) {
    return '<li><span class="k">' + label + '</span><span class="v ' + (cls || "") + '">' + value + "</span></li>";
  }

  function closeDrawer() {
    selectedISO = null;
    $("drawer").hidden = true;
    $("drawerBackdrop").hidden = true;
    render();
  }

  function drawerSummary() {
    var iso = selectedISO;
    if (!iso) return "";
    var date = R.fromISO(iso);
    var day = R.describeDay(pattern(), date);
    var swing = R.swingsInRange(pattern(), R.addDays(date, -pattern().cycle), R.addDays(date, pattern().cycle))
      .filter(function (s) { return s.number === day.swing; })[0];
    var lines = [
      R.longDateLabel(date),
      statusText(day) + " · " + positionText(day) + " · " + (day.shift === "night" ? "Nights" : "Days"),
      "Roster: " + state.onsite + " on / " + state.off + " off (cycle " + (state.onsite + state.off) + " days)"
    ];
    if (swing) {
      lines.push("Swing " + swingLabel(swing.number) + ": fly in " + R.shortDateLabel(swing.flyIn) + ", fly out " + R.shortDateLabel(swing.flyOut));
    }
    if (R.paydaysInRange(payConfig(), date, date).length) lines.push("Pay day");
    if (state.notes[iso]) lines.push("Note: " + state.notes[iso]);
    return lines.join("\n");
  }

  /* ------------------------------------------------------------------ ics */

  function icsDate(date) {
    return date.getFullYear() + R.pad2(date.getMonth() + 1) + R.pad2(date.getDate());
  }

  function icsEscape(text) {
    return String(text).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  }

  function icsFold(line) {
    if (line.length <= 74) return line;
    var out = [];
    var rest = line;
    out.push(rest.slice(0, 74));
    rest = rest.slice(74);
    while (rest.length) {
      out.push(" " + rest.slice(0, 73));
      rest = rest.slice(73);
    }
    return out.join("\r\n");
  }

  function buildICS() {
    var pat = pattern();
    var pay = payConfig();
    var start = R.startOfMonth(R.fromISO(state.cursor));
    var end = R.addDays(R.addMonths(start, 12), -1);
    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SWING//FIFO Roster Planner//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:SWING " + state.onsite + "/" + state.off + " roster"
    ];

    function event(uid, dateStart, dateEnd, summary, description, alarm) {
      lines.push("BEGIN:VEVENT");
      lines.push("UID:" + uid + "@swing.roster");
      lines.push("DTSTAMP:" + icsDate(R.today()) + "T000000Z");
      lines.push("DTSTART;VALUE=DATE:" + icsDate(dateStart));
      lines.push("DTEND;VALUE=DATE:" + icsDate(dateEnd || R.addDays(dateStart, 1)));
      lines.push("SUMMARY:" + icsEscape(summary));
      lines.push("DESCRIPTION:" + icsEscape(description));
      lines.push("TRANSP:TRANSPARENT");
      if (alarm) {
        lines.push("BEGIN:VALARM");
        lines.push("TRIGGER:-PT12H");
        lines.push("ACTION:DISPLAY");
        lines.push("DESCRIPTION:" + icsEscape(summary));
        lines.push("END:VALARM");
      }
      lines.push("END:VEVENT");
    }

    R.swingsInRange(pat, start, end).forEach(function (swing) {
      var shift = swing.shift === "night" ? "Nights" : "Days";
      event("swing-" + swing.number, swing.flyIn, R.addDays(swing.flyOut, 1),
        "Onsite · swing #" + swing.number + " (" + shift + ")",
        state.onsite + " days onsite, " + state.off + " days home. Fly in " + R.shortDateLabel(swing.flyIn) + ", fly out " + R.shortDateLabel(swing.flyOut) + ".");
      event("flyin-" + swing.number, swing.flyIn, null, "✈ Fly in · swing #" + swing.number,
        "First day of swing #" + swing.number + ".", true);
      event("flyout-" + swing.number, swing.flyOut, null, "✈ Fly out · swing #" + swing.number,
        "Last day of swing #" + swing.number + ".", true);
    });

    R.paydaysInRange(pay, start, end).forEach(function (date) {
      event("pay-" + icsDate(date), date, null, "Pay day", "Pay day — " + R.payLabel(pay));
    });

    Object.keys(state.notes).forEach(function (iso) {
      var text = (state.notes[iso] || "").trim();
      if (!text) return;
      var date = R.fromISO(iso);
      if (R.diffDays(start, date) < 0 || R.diffDays(date, end) < 0) return;
      event("note-" + iso, date, null, "Roster note: " + text, text);
    });

    lines.push("END:VCALENDAR");
    return lines.map(icsFold).join("\r\n");
  }

  function downloadICS() {
    var blob = new Blob([buildICS()], { type: "text/calendar;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "swing-roster-" + state.onsite + "-" + state.off + ".ics";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("Calendar file downloaded — 12 months of swings");
  }

  /* ---------------------------------------------------------- print sheet */

  function sheetOptions() {
    return {
      paper: $("sheetPaper").value,
      orientation: $("sheetOrientation").value,
      notes: $("sheetNotes").checked,
      swings: $("sheetSwings").checked,
      legend: $("sheetLegend").checked,
      colour: $("sheetColour").checked
    };
  }

  function sheetSize(options) {
    var landscape = options.orientation === "landscape";
    var letter = options.paper === "letter";
    return {
      width: letter ? (landscape ? "279mm" : "216mm") : (landscape ? "297mm" : "210mm"),
      height: letter ? (landscape ? "216mm" : "279mm") : (landscape ? "210mm" : "297mm")
    };
  }

  function buildPrintSheet() {
    var pat = pattern();
    var pay = payConfig();
    var options = sheetOptions();
    var cursor = R.fromISO(state.cursor);
    var monthStart = R.startOfMonth(cursor);
    var monthEnd = R.endOfMonth(cursor);
    var gridStart = R.startOfWeek(monthStart, Number(state.weekStart));
    var gridEnd = R.addDays(R.startOfWeek(monthEnd, Number(state.weekStart)), 6);
    var days = R.range(gridStart, gridEnd);
    var today = R.today();
    var stats = R.summarise(pat, pay, monthStart, monthEnd);

    var cells = days.map(function (date) {
      var day = R.describeDay(pat, date);
      var inMonth = date.getMonth() === cursor.getMonth();
      var isPay = R.paydaysInRange(pay, date, date).length > 0;
      var note = state.notes[day.iso];
      var cls = ["ps-day"];
      if (!inMonth) cls.push("ps-outside");
      else cls.push(day.onsite ? "ps-onsite" : "ps-home");
      if (inMonth && day.isFlyIn) cls.push("ps-fly-in");
      if (inMonth && day.isFlyOut) cls.push("ps-fly-out");
      if (isPay) cls.push("ps-pay");
      if (R.isSameDay(date, today)) cls.push("ps-today");

      var status = "";
      var meta = "";
      var flags = "";
      if (inMonth) {
        status = statusText(day);
        meta = day.onsite
          ? "Day " + day.dayOfSwing + " of " + day.daysInSwing + " · " + (day.shift === "night" ? "Nights" : "Days")
          : "R&R day " + day.dayOfBreak + " of " + day.daysOfBreak;
        if (day.isFlyIn) flags += '<span class="ps-flag fly">Fly in</span>';
        if (day.isFlyOut) flags += '<span class="ps-flag fly">' + (day.onsite ? "Fly out" : "Home") + "</span>";
      }
      if (isPay) flags += '<span class="ps-flag pay">Pay</span>';

      return '<div class="' + cls.join(" ") + '">' +
        '<span class="ps-num">' + date.getDate() + "</span>" +
        (status ? '<span class="ps-status">' + status + "</span>" : "") +
        (meta ? '<span class="ps-meta-line">' + meta + "</span>" : "") +
        (flags ? '<span class="ps-flags">' + flags + "</span>" : "") +
        (options.notes && note ? '<span class="ps-note">' + escapeHtml(note) + "</span>" : "") +
        "</div>";
    }).join("");

    var swings = R.swingsInRange(pat, monthStart, monthEnd);
    var swingRows = swings.map(function (swing) {
      var payDays = R.paydaysInRange(pay, swing.flyIn, swing.breakEnds);
      return "<tr><td>#" + swing.number + "</td>" +
        "<td>" + R.shortDateLabel(swing.flyIn) + "</td>" +
        "<td>" + R.shortDateLabel(swing.flyOut) + "</td>" +
        "<td>" + swing.days + "</td>" +
        "<td>" + (swing.shift === "night" ? "Nights" : "Days") + "</td>" +
        "<td>" + payDays.length + "</td></tr>";
    }).join("");

    var sheet = $("printSheet");
    sheet.classList.toggle("no-colour", !options.colour);
    sheet.innerHTML =
      '<div class="ps-head">' +
        '<div class="ps-brand">' +
          '<span class="ps-brand-mark"><svg class="icon"><use href="#i-helmet" /></svg></span>' +
          '<div><div class="ps-eyebrow">FIFO roster planner</div><div class="ps-wordmark">SWING</div></div>' +
        "</div>" +
        '<div class="ps-title">' +
          '<div class="ps-month">' + R.MONTHS[cursor.getMonth()] + " " + cursor.getFullYear() + "</div>" +
          '<div class="ps-sub">' + state.onsite + " days on / " + state.off + " days off · " +
            (state.onsite + state.off) + "-day cycle</div>" +
        "</div>" +
      "</div>" +
      '<div class="ps-meta">' +
        "<span>Anchor <b>" + R.shortDateLabel(R.fromISO(state.anchor)) + "</b></span>" +
        "<span>Shift <b>" + (state.shift === "rotate" ? "Rotating" : state.shift === "night" ? "Nights" : "Days") + "</b></span>" +
        "<span>Pay <b>" + R.payLabel(pay) + " from " + R.shortDateLabel(R.fromISO(state.payAnchor)) + "</b></span>" +
      "</div>" +
      '<div class="ps-week">' + R.weekdayInitials(Number(state.weekStart)).map(function (initial) {
        return "<span>" + initial + "</span>";
      }).join("") + "</div>" +
      '<div class="ps-grid" style="grid-template-rows: repeat(' + (days.length / 7) + ', minmax(0, 1fr))">' +
        cells + "</div>" +
      '<div class="ps-summary">' +
        "<div><b>" + stats.onsite + "</b><span>Days onsite</span></div>" +
        "<div><b>" + stats.home + "</b><span>Days home</span></div>" +
        "<div><b>" + stats.homePercent + "%</b><span>Home share</span></div>" +
        "<div><b>" + stats.swings + "</b><span>Swings</span></div>" +
        "<div><b>" + stats.paydays + "</b><span>Pay days</span></div>" +
      "</div>" +
      (options.swings && swings.length
        ? '<div class="ps-swings"><h4>Swings in ' + R.MONTHS[cursor.getMonth()] + "</h4><table>" +
            "<thead><tr><th>Swing</th><th>Fly in</th><th>Fly out</th><th>Days on</th><th>Shift</th><th>Pay days</th></tr></thead>" +
            "<tbody>" + swingRows + "</tbody></table></div>"
        : "") +
      '<div class="ps-foot">' +
        (options.legend
          ? '<div class="ps-legend">' +
              '<span><i style="background:var(--p-onsite)"></i>Onsite</span>' +
              '<span><i style="background:var(--p-home)"></i>Home</span>' +
              '<span><i style="background:var(--p-fly)"></i>Fly in / out</span>' +
              '<span><i style="background:var(--p-pay)"></i>Pay day</span>' +
            "</div>"
          : "<span></span>") +
        "<span>Generated " + R.shortDateLabel(today) + " · confirm against your official roster</span>" +
      "</div>";
  }

  function fitPrintSheet() {
    var sheet = $("printSheet");
    var scroll = $("sheetScroll");
    if (!sheet || !scroll || $("sheetModal").hidden) return;
    var options = sheetOptions();
    var size = sheetSize(options);
    sheet.style.width = size.width;
    sheet.style.minHeight = size.height;
    sheet.style.zoom = "";
    var natural = sheet.getBoundingClientRect().width;
    var available = scroll.clientWidth - 32;
    sheet.style.zoom = natural ? Math.min(1, available / natural).toFixed(3) : 1;
    $("sheetHint").textContent = (options.paper === "letter" ? "US Letter" : "A4") + " · " +
      options.orientation + " · " + R.monthLabel(R.fromISO(state.cursor));
  }

  function openPrintSheet() {
    $("sheetModalTitle").textContent = R.monthLabel(R.fromISO(state.cursor));
    $("sheetModal").hidden = false;
    $("sheetBackdrop").hidden = false;
    buildPrintSheet();
    fitPrintSheet();
  }

  function closePrintSheet() {
    $("sheetModal").hidden = true;
    $("sheetBackdrop").hidden = true;
  }

  function refreshPrintSheet() {
    if ($("sheetModal").hidden) return;
    buildPrintSheet();
    fitPrintSheet();
  }

  function printPrintSheet() {
    var options = sheetOptions();
    var rule = "@page { size: " + (options.paper === "letter" ? "letter" : "A4") + " " +
      options.orientation + "; margin: 12mm; }";
    var tag = $("sheetPageStyle");
    if (!tag) {
      tag = document.createElement("style");
      tag.id = "sheetPageStyle";
      document.head.appendChild(tag);
    }
    tag.textContent = rule;
    document.body.classList.add("sheet-printing");
    var clear = function () {
      document.body.classList.remove("sheet-printing");
      window.removeEventListener("afterprint", clear);
      clearTimeout(fallback);
    };
    var fallback = setTimeout(clear, 2000);   // some browsers never fire afterprint
    window.addEventListener("afterprint", clear);
    window.print();
  }

  /* ---------------------------------------------------------------- share */

  function shareURL() {
    var base = window.location.origin + window.location.pathname;
    var query = toQuery();
    return base + (query ? "?" + query : "");
  }

  /* ----------------------------------------------------------------- init */

  function commitCustomNumbers() {
    syncPresetFromNumbers();
    save();
    render();
  }

  function moveCursor(months) {
    var next = R.addMonths(R.fromISO(state.cursor), months);
    setState({ cursor: R.toISO(next) });
  }

  function setView(view) {
    setState({ view: view });
  }

  function bind() {
    $("presetGrid").addEventListener("click", function (event) {
      var btn = event.target.closest("[data-preset]");
      if (!btn) return;
      var id = btn.getAttribute("data-preset");
      setState({
        preset: id,
        onsite: Number(btn.getAttribute("data-onsite")) || state.onsite,
        off: Number(btn.getAttribute("data-off")) || state.off
      });
    });

    $("onsiteInput").addEventListener("change", function () {
      state.onsite = R.clampInt(this.value, 1, 120, state.onsite);
      commitCustomNumbers();
    });
    $("offInput").addEventListener("change", function () {
      state.off = R.clampInt(this.value, 1, 120, state.off);
      commitCustomNumbers();
    });
    $("anchorInput").addEventListener("change", function () {
      if (/^\d{4}-\d{2}-\d{2}$/.test(this.value)) setState({ anchor: this.value });
      else this.value = state.anchor;
    });
    $("anchorTodayBtn").addEventListener("click", function () {
      setState({ anchor: R.toISO(R.today()) });
      toast("Anchor set to today");
    });
    $("travelSelect").addEventListener("change", function () {
      setState({ flyOutAsHome: this.value === "home" });
    });

    $("shiftSegmented").addEventListener("click", function (event) {
      var btn = event.target.closest("[data-shift]");
      if (btn) setState({ shift: btn.getAttribute("data-shift") });
    });
    $("weekStartSegmented").addEventListener("click", function (event) {
      var btn = event.target.closest("[data-week]");
      if (btn) setState({ weekStart: Number(btn.getAttribute("data-week")) });
    });
    $("viewSwitch").addEventListener("click", function (event) {
      var btn = event.target.closest("[data-view]");
      if (btn) setView(btn.getAttribute("data-view"));
    });

    $("payFreq").addEventListener("change", function () { setState({ payFreq: this.value }); });
    $("payEvery").addEventListener("change", function () {
      setState({ payEvery: R.clampInt(this.value, 1, 365, 28) });
    });
    $("payAnchor").addEventListener("change", function () {
      if (/^\d{4}-\d{2}-\d{2}$/.test(this.value)) setState({ payAnchor: this.value });
    });
    $("payAmount").addEventListener("change", function () {
      var value = parseFloat(this.value);
      setState({ payAmount: isFinite(value) && value >= 0 ? value : null });
    });

    ["showNotes", "showPay", "showOutside"].forEach(function (id) {
      $(id).addEventListener("change", function () {
        var patch = {};
        patch[id] = this.checked;
        setState(patch);
      });
    });

    $("prevBtn").addEventListener("click", function () { moveCursor(state.view === "year" ? -12 : state.view === "quarter" ? -3 : -1); });
    $("nextBtn").addEventListener("click", function () { moveCursor(state.view === "year" ? 12 : state.view === "quarter" ? 3 : 1); });
    $("todayBtn").addEventListener("click", function () {
      setState({ cursor: R.toISO(R.startOfMonth(R.today())) });
    });

    $("calendar").addEventListener("click", function (event) {
      var jump = event.target.closest("[data-jump]");
      if (jump) {
        setState({ cursor: jump.getAttribute("data-jump"), view: "month" });
        return;
      }
      var cell = event.target.closest("[data-iso]");
      if (cell) openDrawer(cell.getAttribute("data-iso"));
    });

    $("drawerClose").addEventListener("click", closeDrawer);
    $("drawerDone").addEventListener("click", closeDrawer);
    $("drawerBackdrop").addEventListener("click", closeDrawer);
    $("drawerCopy").addEventListener("click", function () {
      copyText(drawerSummary()).then(function () { toast("Day summary copied"); })
        .catch(function () { toast("Copy failed — select the text instead"); });
    });

    var noteTimer = null;
    $("drawerNote").addEventListener("input", function () {
      var iso = selectedISO;
      var value = this.value;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(function () {
        if (!iso) return;
        if (value.trim()) state.notes[iso] = value;
        else delete state.notes[iso];
        save();
        render();
      }, 350);
    });

    $("shareBtn").addEventListener("click", function () {
      copyText(shareURL()).then(function () { toast("Share link copied to clipboard"); })
        .catch(function () { toast("Copy failed — the link is in the address bar"); });
    });
    $("icsBtn").addEventListener("click", downloadICS);
    $("printBtn").addEventListener("click", function () { window.print(); });

    $("printMonthBtn").addEventListener("click", openPrintSheet);
    $("sheetClose").addEventListener("click", closePrintSheet);
    $("sheetCancel").addEventListener("click", closePrintSheet);
    $("sheetBackdrop").addEventListener("click", closePrintSheet);
    $("sheetPrintBtn").addEventListener("click", printPrintSheet);
    ["sheetPaper", "sheetOrientation", "sheetNotes", "sheetSwings", "sheetLegend", "sheetColour"]
      .forEach(function (id) {
        $(id).addEventListener("change", refreshPrintSheet);
      });

    $("resetBtn").addEventListener("click", function () {
      if (!window.confirm("Reset the roster, pay settings and notes back to defaults?")) return;
      state = defaults();
      save();
      closeDrawer();
      toast("Roster reset to an 8/6 swing");
    });

    $("sidebarToggle").addEventListener("click", function () {
      var sidebar = $("sidebar");
      var open = sidebar.classList.toggle("open");
      this.setAttribute("aria-expanded", open ? "true" : "false");
    });

    document.addEventListener("keydown", function (event) {
      var tag = (event.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (event.key === "ArrowLeft") moveCursor(state.view === "year" ? -12 : state.view === "quarter" ? -3 : -1);
      else if (event.key === "ArrowRight") moveCursor(state.view === "year" ? 12 : state.view === "quarter" ? 3 : 1);
      else if (event.key === "Escape") {
        if (!$("sheetModal").hidden) closePrintSheet();
        else if (selectedISO) closeDrawer();
        else if ($("sidebar").classList.contains("open")) $("sidebar").classList.remove("open");
      }
      else if (event.key.toLowerCase() === "t") $("todayBtn").click();
      else if (event.key.toLowerCase() === "m") setView("month");
      else if (event.key.toLowerCase() === "y") setView("year");
      else if (event.key === "3") setView("quarter");
      else return;
      event.preventDefault();
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 1000) $("sidebar").classList.remove("open");
      fitPrintSheet();
    });
  }

  function init() {
    load();
    buildPayOptions();
    bind();
    render();
    if (window.location.search) {
      setTimeout(function () { toast("Loaded a shared roster — saved to this browser"); }, 400);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}());
