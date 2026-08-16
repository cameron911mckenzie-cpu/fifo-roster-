/* ============================================================
   FIFO Roster Calendar — rolling roster engine + month renderer
   ============================================================ */
(function () {
  "use strict";

  var STORAGE_KEY = "fifo-roster-settings-v1";
  var MS_DAY = 86400000;

  // ---------- Helpers ----------
  function $(id) { return document.getElementById(id); }

  function ymd(d) {
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }
  function parseYMD(s) {
    var p = s.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  // Day count difference ignoring DST (use UTC-noon trick)
  function dayDiff(a, b) {
    var ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    var ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((ua - ub) / MS_DAY);
  }
  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }
  function mod(n, m) { return ((n % m) + m) % m; }

  // ---------- Default settings ----------
  function defaults() {
    var today = new Date();
    return {
      workerName: "",
      preset: "7,7",
      daysOn: 7,
      daysOff: 7,
      startDate: ymd(today),
      rotation: "days",
      splitCount: 4,
      altFirst: "day",
      flyOutMode: "last",
      payFreq: "fortnightly",
      payRef: ymd(today),
      weekStart: 1
    };
  }

  var settings = loadSettings();
  var view = { year: new Date().getFullYear(), month: new Date().getMonth() };

  function loadSettings() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        return Object.assign(defaults(), s);
      }
    } catch (e) { /* ignore */ }
    return defaults();
  }
  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  // ---------- Roster engine ----------
  // Returns status object for a given date, based on rolling cycle.
  // Statuses: flyin, day, night, flyout, home
  function getStatus(date) {
    var on = Math.max(1, settings.daysOn | 0);
    var off = Math.max(1, settings.daysOff | 0);
    var cycle = on + off;
    var start = parseYMD(settings.startDate);

    var diff = dayDiff(date, start);
    var pos = mod(diff, cycle);           // 0 .. cycle-1, 0 = fly-in day
    var swingIndex = Math.floor((diff - pos) / cycle); // which swing number (can be negative)

    var onSite = pos < on;
    var st = { key: "home", label: "Home", sub: "", icon: "" };

    if (onSite) {
      // Determine shift type for this position within the swing
      var shift = shiftFor(pos, on, swingIndex);
      if (shift === "night") st = { key: "night", label: "Night shift", sub: "", icon: "🌙" };
      else st = { key: "day", label: "Day shift", sub: "", icon: "☀" };

      // Fly day overlays
      if (pos === 0) {
        st = { key: "flyin", label: "Fly in", sub: (shift === "night" ? "Night shift" : "Day shift"), icon: "🛬" };
      }
      if (settings.flyOutMode === "last" && pos === on - 1) {
        st = { key: "flyout", label: "Fly out", sub: (shift === "night" ? "Night shift" : "Day shift"), icon: "🛫" };
      }
    } else {
      var offPos = pos - on; // 0 .. off-1
      if (settings.flyOutMode === "after" && offPos === 0) {
        st = { key: "flyout", label: "Fly out", sub: "Travel home", icon: "🛫" };
      } else {
        var dayOfBreak = offPos + 1;
        st = { key: "home", label: "Home / R&R", sub: "Day " + dayOfBreak + " of " + off, icon: "🏠" };
      }
    }

    // Add "day X of Y" sub for on-site days
    if (onSite && (st.key === "day" || st.key === "night")) {
      st.sub = "Day " + (pos + 1) + " of " + on;
    }
    if (st.key === "flyin") st.sub += " · Day 1 of " + on;
    if (st.key === "flyout" && settings.flyOutMode === "last") st.sub += " · Day " + on + " of " + on;

    st.pos = pos;
    st.swingIndex = swingIndex;
    st.onSite = onSite;
    return st;
  }

  function shiftFor(pos, on, swingIndex) {
    switch (settings.rotation) {
      case "nights": return "night";
      case "split-dn": {
        var k = clampSplit(on);
        return pos < k ? "day" : "night";
      }
      case "split-nd": {
        var k2 = clampSplit(on);
        return pos < k2 ? "night" : "day";
      }
      case "alt": {
        var firstNight = settings.altFirst === "night";
        var isEven = mod(swingIndex, 2) === 0;
        var nightSwing = firstNight ? isEven : !isEven;
        return nightSwing ? "night" : "day";
      }
      default: return "day";
    }
  }
  function clampSplit(on) {
    var k = settings.splitCount | 0;
    if (k < 1) k = 1;
    if (k > on - 1) k = Math.max(1, on - 1);
    return k;
  }

  // ---------- Pay days ----------
  function isPayDay(date) {
    if (settings.payFreq === "none" || !settings.payRef) return false;
    var ref = parseYMD(settings.payRef);
    if (settings.payFreq === "weekly") return mod(dayDiff(date, ref), 7) === 0;
    if (settings.payFreq === "fortnightly") return mod(dayDiff(date, ref), 14) === 0;
    if (settings.payFreq === "monthly") {
      var wanted = ref.getDate();
      var lastOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      // If wanted day doesn't exist this month (e.g. 31st), pay on last day
      var target = Math.min(wanted, lastOfMonth);
      return date.getDate() === target;
    }
    return false;
  }

  // ---------- Rendering ----------
  var MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
  var DOW_MON = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  var DOW_SUN = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  function render() {
    renderCalendar();
    renderHeader();
    saveSettings();
  }

  function renderHeader() {
    $("monthTitle").textContent = MONTHS[view.month] + " " + view.year;

    var patternTxt = settings.daysOn + " on / " + settings.daysOff + " off";
    var rotTxt = {
      "days": "day shifts",
      "nights": "night shifts",
      "split-dn": "days → nights",
      "split-nd": "nights → days",
      "alt": "alternating day/night swings"
    }[settings.rotation];

    var sub = patternTxt + " · " + rotTxt;
    if (settings.workerName) sub = settings.workerName + " · " + sub;
    $("printSubtitle").textContent = sub;
    $("footerPattern").textContent =
      "Roster: " + patternTxt + " · " + rotTxt +
      " · Swing anchor: " + formatNice(parseYMD(settings.startDate)) +
      (settings.payFreq !== "none" ? " · Pay: " + settings.payFreq : "");

    // Swing summary: next fly-in and fly-out from today
    var today = new Date();
    var nextFlyIn = findNext(today, function (d) { return getStatus(d).key === "flyin"; });
    var nextFlyOut = findNext(today, function (d) { return getStatus(d).key === "flyout"; });
    var todaySt = getStatus(today);
    var html = "Today: <b>" + todaySt.label + "</b>";
    if (nextFlyIn) html += "<br>Next fly-in: <b>" + formatNice(nextFlyIn) + "</b>";
    if (nextFlyOut) html += "<br>Next fly-out: <b>" + formatNice(nextFlyOut) + "</b>";
    $("swingSummary").innerHTML = html;
  }

  function findNext(from, pred) {
    for (var i = 1; i <= 120; i++) {
      var d = addDays(from, i);
      if (pred(d)) return d;
    }
    return null;
  }

  function formatNice(d) {
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  }

  function renderCalendar() {
    var cal = $("calendar");
    cal.innerHTML = "";

    var weekStart = +settings.weekStart; // 1 = Mon, 0 = Sun
    var dows = weekStart === 1 ? DOW_MON : DOW_SUN;
    dows.forEach(function (name) {
      var el = document.createElement("div");
      el.className = "dow";
      el.textContent = name;
      cal.appendChild(el);
    });

    var first = new Date(view.year, view.month, 1);
    var lead = mod(first.getDay() - weekStart, 7);
    var gridStart = addDays(first, -lead);
    var daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
    var totalCells = Math.ceil((lead + daysInMonth) / 7) * 7;

    var todayStr = ymd(new Date());

    for (var i = 0; i < totalCells; i++) {
      var d = addDays(gridStart, i);
      var st = getStatus(d);
      var cell = document.createElement("div");
      var cls = "cell st-" + st.key;
      if (d.getMonth() !== view.month) cls += " other-month";
      if (ymd(d) === todayStr) cls += " today";
      if (isPayDay(d)) cls += " payday";
      cell.className = cls;

      var dateRow = document.createElement("div");
      dateRow.className = "date-row";
      var num = document.createElement("span");
      num.className = "date-num";
      num.textContent = d.getDate();
      var ic = document.createElement("span");
      ic.className = "icon";
      ic.textContent = st.icon;
      dateRow.appendChild(num);
      dateRow.appendChild(ic);
      cell.appendChild(dateRow);

      var tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = st.label;
      cell.appendChild(tag);

      if (st.sub) {
        var sub = document.createElement("div");
        sub.className = "sub";
        sub.textContent = st.sub;
        cell.appendChild(sub);
      }

      cal.appendChild(cell);
    }
  }

  // ---------- Wire up controls ----------
  function bindSettingsToUI() {
    $("workerName").value = settings.workerName;
    $("preset").value = presetValue();
    $("daysOn").value = settings.daysOn;
    $("daysOff").value = settings.daysOff;
    $("startDate").value = settings.startDate;
    $("rotation").value = settings.rotation;
    $("splitCount").value = settings.splitCount;
    $("altFirst").value = settings.altFirst;
    $("flyOutMode").value = settings.flyOutMode;
    $("payFreq").value = settings.payFreq;
    $("payRef").value = settings.payRef;
    $("weekStart").value = String(settings.weekStart);
    updateConditionalFields();
  }

  function presetValue() {
    var map = { "7,7": "7,7", "8,6": "8,6", "14,14": "14,14", "14,7": "14,7", "21,7": "21,7" };
    var key = settings.daysOn + "," + settings.daysOff;
    if (key === "14,14") return "14,14";
    return map[key] || "custom";
  }

  function updateConditionalFields() {
    var r = settings.rotation;
    $("splitField").hidden = !(r === "split-dn" || r === "split-nd");
    $("altField").hidden = r !== "alt";
    $("payRefField").hidden = settings.payFreq === "none";
  }

  function onPresetChange() {
    var v = $("preset").value;
    if (v === "custom") return;
    var parts = v === "2w,2w" ? [14, 14] : v.split(",").map(Number);
    settings.daysOn = parts[0];
    settings.daysOff = parts[1];
    $("daysOn").value = parts[0];
    $("daysOff").value = parts[1];
    render();
  }

  function attach() {
    $("workerName").addEventListener("input", function () { settings.workerName = this.value; render(); });
    $("preset").addEventListener("change", onPresetChange);
    $("daysOn").addEventListener("change", function () {
      settings.daysOn = Math.max(1, +this.value || 1); this.value = settings.daysOn;
      $("preset").value = presetValue(); render();
    });
    $("daysOff").addEventListener("change", function () {
      settings.daysOff = Math.max(1, +this.value || 1); this.value = settings.daysOff;
      $("preset").value = presetValue(); render();
    });
    $("startDate").addEventListener("change", function () {
      if (this.value) { settings.startDate = this.value; render(); }
    });
    $("rotation").addEventListener("change", function () {
      settings.rotation = this.value; updateConditionalFields(); render();
    });
    $("splitCount").addEventListener("change", function () {
      settings.splitCount = Math.max(1, +this.value || 1); this.value = settings.splitCount; render();
    });
    $("altFirst").addEventListener("change", function () { settings.altFirst = this.value; render(); });
    $("flyOutMode").addEventListener("change", function () { settings.flyOutMode = this.value; render(); });
    $("payFreq").addEventListener("change", function () {
      settings.payFreq = this.value; updateConditionalFields(); render();
    });
    $("payRef").addEventListener("change", function () {
      if (this.value) { settings.payRef = this.value; render(); }
    });
    $("weekStart").addEventListener("change", function () { settings.weekStart = +this.value; render(); });

    $("prevMonth").addEventListener("click", function () { shiftMonth(-1); });
    $("nextMonth").addEventListener("click", function () { shiftMonth(1); });
    $("prevYear").addEventListener("click", function () { shiftMonth(-12); });
    $("nextYear").addEventListener("click", function () { shiftMonth(12); });
    $("todayBtn").addEventListener("click", function () {
      var now = new Date();
      view.year = now.getFullYear(); view.month = now.getMonth();
      render();
    });

    $("printBtn").addEventListener("click", function () { window.print(); });
    $("resetBtn").addEventListener("click", function () {
      if (confirm("Reset all roster settings to defaults?")) {
        settings = defaults();
        bindSettingsToUI();
        render();
      }
    });

    // Keyboard navigation
    document.addEventListener("keydown", function (e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      if (e.key === "ArrowLeft") shiftMonth(-1);
      if (e.key === "ArrowRight") shiftMonth(1);
    });
  }

  function shiftMonth(n) {
    var d = new Date(view.year, view.month + n, 1);
    view.year = d.getFullYear();
    view.month = d.getMonth();
    render();
  }

  // ---------- Init ----------
  bindSettingsToUI();
  attach();
  render();
})();
