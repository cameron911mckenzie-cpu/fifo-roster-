/*
 * Gold Scout
 * A deliberately small, dependency-light field planning interface.
 * Live map layers are supplied by Queensland Government services; the target
 * signal is a transparent planning model and must not be treated as a find.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "gold-scout-state-v1";
  var DEFAULT_AREA = "charters";
  var LOCATIONS = [
    { id: "charters", name: "Charters Towers Goldfield", short: "Charters Towers", meta: "20.07° S, 146.27° E", coords: [-20.073, 146.263], zoom: 11 },
    { id: "clermont", name: "Clermont goldfields", short: "Clermont", meta: "22.83° S, 147.63° E", coords: [-22.825, 147.635], zoom: 11 },
    { id: "ravenswood", name: "Ravenswood district", short: "Ravenswood", meta: "20.10° S, 146.89° E", coords: [-20.101, 146.891], zoom: 11 },
    { id: "mount-morgan", name: "Mount Morgan district", short: "Mount Morgan", meta: "23.65° S, 150.39° E", coords: [-23.645, 150.389], zoom: 11 },
    { id: "gympie", name: "Gympie goldfield", short: "Gympie", meta: "26.19° S, 152.66° E", coords: [-26.189, 152.665], zoom: 11 },
    { id: "warwick", name: "Southern Downs", short: "Warwick", meta: "28.22° S, 152.03° E", coords: [-28.219, 152.034], zoom: 11 }
  ];

  var state = loadState();
  var map = null;
  var baseLayers = {};
  var overlayLayers = {};
  var signalLayer = null;
  var inspectionMarker = null;
  var currentLocation = getLocation(state.areaId);
  var activeTarget = null;
  var customPoint = null;
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function getLocation(id) { return LOCATIONS.find(function (item) { return item.id === id; }) || LOCATIONS[0]; }
  function loadState() {
    var fallback = { areaId: DEFAULT_AREA, style: "satellite", saved: [], weights: { fault: 40, drainage: 35, gold: 25 } };
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      var value = JSON.parse(raw);
      return {
        areaId: value.areaId || DEFAULT_AREA,
        style: value.style || "satellite",
        saved: Array.isArray(value.saved) ? value.saved : [],
        weights: Object.assign(fallback.weights, value.weights || {})
      };
    } catch (error) { return fallback; }
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) { /* private mode */ }
  }

  function init() {
    bindStaticUI();
    renderLocation(currentLocation);
    renderSaved();
    updateWeightsUI();
    if (window.L) initMap();
    else showMapFallback();
  }

  function initMap() {
    map = L.map("map", { zoomControl: false, attributionControl: true, preferCanvas: true }).setView(currentLocation.coords, currentLocation.zoom);

    baseLayers.satellite = L.tileLayer(
      "https://spatial-img.information.qld.gov.au/arcgis/rest/services/Basemaps/LatestSatelliteWOS_AllUsers/ImageServer/tile/{z}/{y}/{x}",
      { maxZoom: 18, minZoom: 3, attribution: "Imagery © State of Queensland (Department of Resources)" }
    );
    baseLayers.topo = L.tileLayer(
      "https://gisservices.information.qld.gov.au/arcgis/rest/services/Basemaps/QldMap_Topo/MapServer/tile/{z}/{y}/{x}?blankTile=false&browserCache=Map",
      { maxZoom: 18, minZoom: 3, attribution: "Topo © State of Queensland (Department of Resources)" }
    );
    baseLayers.street = L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 19, minZoom: 3, subdomains: "abc", attribution: "© OpenStreetMap contributors" }
    );
    setBasemap(state.style, false);

    var permitsUrl = "https://spatial-gis.information.qld.gov.au/arcgis/services/Economy/MinesPermitsCurrent/MapServer/WMSServer";
    var geologyUrl = "https://gisservices.information.qld.gov.au/arcgis/services/GeoscientificInformation/GeologyDetailed/MapServer/WMSServer";
    var resourcesUrl = "https://spatial-gis.information.qld.gov.au/arcgis/services/GeoscientificInformation/MiningResources/MapServer/WMSServer";
    var stateGeologyUrl = "https://spatial-gis.information.qld.gov.au/arcgis/services/GeoscientificInformation/GeologyState/MapServer/WMSServer";
    var geophysicsUrl = "https://spatial-gis.information.qld.gov.au/arcgis/services/GeoscientificInformation/Geophysics/MapServer/WMSServer";

    overlayLayers.leases = L.tileLayer.wms(permitsUrl, {
      layers: "44", format: "image/png", transparent: true, version: "1.3.0", opacity: .8,
      attribution: "Tenure © State of Queensland"
    });
    overlayLayers.permits = L.tileLayer.wms(permitsUrl, {
      layers: "3", format: "image/png", transparent: true, version: "1.3.0", opacity: .68,
      attribution: "Permits © State of Queensland"
    });
    overlayLayers.faults = L.tileLayer.wms(geologyUrl, {
      layers: "4", format: "image/png", transparent: true, version: "1.3.0", opacity: .9,
      attribution: "Geology © State of Queensland"
    });
    overlayLayers.occurrences = L.tileLayer.wms(resourcesUrl, {
      layers: "17", format: "image/png", transparent: true, version: "1.3.0", opacity: .9,
      attribution: "Mineral occurrences © State of Queensland"
    });
    overlayLayers.geology = L.tileLayer.wms(stateGeologyUrl, {
      layers: "6", format: "image/png", transparent: true, version: "1.3.0", opacity: .34,
      attribution: "Geology © State of Queensland"
    });
    overlayLayers.geophysics = L.tileLayer.wms(geophysicsUrl, {
      layers: "20", format: "image/png", transparent: true, version: "1.3.0", opacity: .53,
      attribution: "Geophysics © State of Queensland"
    });
    overlayLayers.roads = L.tileLayer(
      "https://gisservices4.information.qld.gov.au/arcgis/rest/services/Transportation/RoadsCache/MapServer/tile/{z}/{y}/{x}?blankTile=false&browserCache=Map",
      { maxZoom: 18, minZoom: 3, opacity: .7, attribution: "Roads © State of Queensland" }
    );

    Object.keys(overlayLayers).forEach(function (key) {
      if (key === "leases" || key === "faults") overlayLayers[key].addTo(map);
    });
    rebuildSignalLayer();
    if (document.querySelector('[data-layer="signals"]').checked) signalLayer.addTo(map);
    selectTarget(getTargets(currentLocation.coords)[0]);

    map.on("click", handleMapClick);
    map.on("mousemove", function (event) { updateCoordinate(event.latlng); });
    map.on("zoomend", updateMapMeta);
    map.on("moveend", updateMapMeta);
    setTimeout(function () { map.invalidateSize(); }, 100);
  }

  function showMapFallback() {
    var mapEl = $("map");
    mapEl.innerHTML = '<div class="map-fallback"><span>Map tiles need an internet connection</span><strong>QLD field map</strong><small>Layer controls are still available. Reconnect to load live imagery.</small></div>';
  }

  function setBasemap(style, announce) {
    state.style = style;
    document.querySelectorAll(".style-button").forEach(function (button) {
      button.classList.toggle("active", button.dataset.style === style);
    });
    if (!map || !baseLayers[style]) return;
    Object.keys(baseLayers).forEach(function (key) {
      if (map.hasLayer(baseLayers[key])) map.removeLayer(baseLayers[key]);
    });
    baseLayers[style].addTo(map);
    if (announce) showToast(style === "satellite" ? "Latest QLD imagery selected" : style.charAt(0).toUpperCase() + style.slice(1) + " basemap selected");
    saveState();
  }

  function toggleLayer(key, enabled) {
    if (!map || !overlayLayers[key] && key !== "signals") return;
    var layer = key === "signals" ? signalLayer : overlayLayers[key];
    if (!layer) return;
    if (enabled) layer.addTo(map);
    else map.removeLayer(layer);
    updateLayerCount();
  }

  function updateLayerCount() {
    var count = Array.from(document.querySelectorAll(".layer-toggle")).filter(function (input) { return input.checked; }).length;
    $("layerCount").textContent = count;
  }

  function rebuildSignalLayer() {
    if (!window.L) return;
    var wasVisible = signalLayer && map && map.hasLayer(signalLayer);
    if (signalLayer && map) map.removeLayer(signalLayer);
    signalLayer = L.layerGroup();
    var targets = getTargets(currentLocation.coords);

    // Soft rings create a useful visual hierarchy without pretending to be a heatmap measurement.
    targets.forEach(function (target, index) {
      L.circle(target.coords, {
        radius: target.radius,
        color: index === 0 ? "#e5ad47" : "#b7834a",
        weight: 1,
        opacity: .74,
        fillColor: index === 0 ? "#e5ad47" : "#bb8a51",
        fillOpacity: index === 0 ? .13 : .09,
        dashArray: index === 0 ? "3 7" : "2 8",
        interactive: false
      }).addTo(signalLayer);
      L.circle(target.coords, {
        radius: target.radius * .42,
        color: "#f2c15d",
        weight: 1,
        opacity: .34,
        fillColor: "#d18f3f",
        fillOpacity: .08,
        interactive: false
      }).addTo(signalLayer);

      var icon = L.divIcon({ className: "signal-icon", html: '<div class="signal-marker"><span>' + target.number + '</span></div>', iconSize: [24, 24], iconAnchor: [12, 22] });
      var marker = L.marker(target.coords, { icon: icon, zIndexOffset: 100 + (3 - index) * 10 }).addTo(signalLayer);
      marker.bindTooltip("Target " + target.number + " · " + target.score + "/100", { direction: "top", offset: [0, -13], className: "signal-tooltip" });
      marker.on("click", function (event) {
        if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
        selectTarget(target);
      });
    });

    // A restrained, local corridor cue for the model preview.
    var corridor = targets.map(function (item) { return item.coords; });
    L.polyline(corridor, { color: "#e5ad47", weight: 2, opacity: .65, dashArray: "2 9", interactive: false }).addTo(signalLayer);
    if (wasVisible || (map && document.querySelector('[data-layer="signals"]').checked)) signalLayer.addTo(map);
    if (activeTarget) {
      var newActive = targets.find(function (target) { return target.id === activeTarget.id; });
      if (newActive) activeTarget = newActive;
    }
  }

  function getTargets(center) {
    var weights = state.weights;
    var offsets = [
      { id: "target-1", number: "01", offset: [0.025, 0.060], title: "Burdekin drainage edge", radius: 2200, values: [76, 75, 61], chips: ["Fault edge", "Low slope", "Outside shown ML"], description: "A high-signal starting point where mapped structure meets a broad alluvial corridor." },
      { id: "target-2", number: "02", offset: [-0.040, -0.022], title: "Old terrace intersection", radius: 1750, values: [72, 68, 70], chips: ["Structure", "Terrace setting", "Occurrence nearby"], description: "A second-pass target with a stronger historical evidence signal and moderate access context." },
      { id: "target-3", number: "03", offset: [0.060, -0.078], title: "Western lineament break", radius: 1450, values: [85, 48, 45], chips: ["Strong structure", "Higher ground", "Needs checking"], description: "A structural lead worth checking against terrain, access and current tenure before committing a trip." }
    ];
    var total = Math.max(1, Number(weights.fault) + Number(weights.drainage) + Number(weights.gold));
    return offsets.map(function (item) {
      var weighted = (item.values[0] * Number(weights.fault) + item.values[1] * Number(weights.drainage) + item.values[2] * Number(weights.gold)) / total;
      var score = Math.round(weighted);
      return Object.assign({}, item, {
        score: clamp(score, 1, 99),
        coords: [center[0] + item.offset[0], center[1] + item.offset[1]]
      });
    });
  }

  function selectTarget(target) {
    activeTarget = target;
    customPoint = null;
    if (inspectionMarker && map) { map.removeLayer(inspectionMarker); inspectionMarker = null; }
    renderInsight(target);
  }

  function handleMapClick(event) {
    var point = { id: "pin-" + Date.now(), number: "—", title: "Dropped field pin", coords: [event.latlng.lat, event.latlng.lng], score: null, description: "A manual point on the map. Add a note after checking the visible planning layers and access context.", chips: ["Manual point", "Check tenure", "Check access"] };
    customPoint = point;
    activeTarget = null;
    if (inspectionMarker) map.removeLayer(inspectionMarker);
    inspectionMarker = L.marker(point.coords, { icon: L.divIcon({ className: "user-pin-icon", html: '<div class="user-marker"></div>', iconSize: [15, 15], iconAnchor: [7, 7] }) }).addTo(map);
    inspectionMarker.bindTooltip("Selected field point", { direction: "top", offset: [0, -8] }).openTooltip();
    renderInsight(point);
    updateCoordinate(event.latlng);
  }

  function renderInsight(item) {
    var isCustom = !item.score;
    $("insightTitle").textContent = item.title;
    $("insightScore").textContent = isCustom ? "—" : item.score;
    $("insightScore").parentElement.querySelector("span").textContent = isCustom ? "" : "/100";
    $("insightDescription").textContent = item.description;
    document.querySelector(".target-number").textContent = isCustom ? "⌖" : item.number;
    document.querySelector(".target-label").textContent = isCustom ? "FIELD NOTE" : "MODEL TARGET";
    var chips = $("mapInsight").querySelector(".signal-chips");
    chips.innerHTML = "";
    var chipList = Array.isArray(item.chips) ? item.chips : ["Saved target", "Check tenure", "Check access"];
    chipList.forEach(function (chip, index) {
      var span = document.createElement("span");
      span.innerHTML = '<i class="chip-dot ' + (index === 1 ? "blue-dot" : index === 2 ? "coral-dot" : "gold-dot") + '"></i>' + chip;
      chips.appendChild(span);
    });
    var saveButton = $("saveTargetBtn");
    var alreadySaved = state.saved.some(function (saved) { return saved.id === item.id; });
    saveButton.classList.toggle("saved", alreadySaved);
    saveButton.innerHTML = alreadySaved ? "<span>★</span> Saved" : "<span>☆</span> Save target";
    $("mapInsight").classList.remove("hidden");
  }

  function getActiveItem() {
    if (customPoint) return customPoint;
    if (activeTarget) return activeTarget;
    var targets = getTargets(currentLocation.coords);
    return targets[0];
  }

  function saveActiveTarget() {
    var item = getActiveItem();
    var existing = state.saved.findIndex(function (saved) { return saved.id === item.id; });
    if (existing >= 0) {
      state.saved.splice(existing, 1);
      showToast("Removed from saved targets");
    } else {
      state.saved.unshift({ id: item.id, title: item.title, score: item.score, coords: item.coords, number: item.number, description: item.description, chips: item.chips, area: currentLocation.short, savedAt: new Date().toISOString() });
      showToast("Target saved to your shortlist ★");
    }
    saveState();
    renderSaved();
    renderInsight(item);
  }

  function renderSaved() {
    var list = $("savedList");
    var empty = $("emptySaved");
    list.innerHTML = "";
    $("savedCount").textContent = state.saved.length;
    empty.style.display = state.saved.length ? "none" : "block";
    state.saved.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "saved-item";
      row.innerHTML = '<span class="saved-pin">⌖</span><span><strong>' + escapeHTML(item.title) + '</strong><small>' + escapeHTML(item.area || "Queensland") + (item.score ? " · " + item.score + "/100" : "") + '</small></span><button class="saved-delete" title="Remove saved target" aria-label="Remove saved target">×</button>';
      row.addEventListener("click", function (event) {
        if (event.target.closest(".saved-delete")) return;
        focusSaved(item);
      });
      row.querySelector(".saved-delete").addEventListener("click", function (event) {
        event.stopPropagation();
        state.saved = state.saved.filter(function (saved) { return saved.id !== item.id; });
        saveState(); renderSaved(); showToast("Target removed");
      });
      list.appendChild(row);
    });
  }

  function focusSaved(item) {
    var distance = Math.abs(item.coords[0] - currentLocation.coords[0]) + Math.abs(item.coords[1] - currentLocation.coords[1]);
    if (map && distance > .6) {
      map.setView(item.coords, 12);
      currentLocation = { id: "saved", name: item.area || "Saved field point", short: item.area || "Saved point", meta: formatCoordinate(item.coords[0], item.coords[1]), coords: item.coords, zoom: 12 };
      renderLocation(currentLocation);
    } else if (map) map.setView(item.coords, Math.max(map.getZoom(), 12));
    var savedItem = Object.assign({
      number: "—",
      description: "A saved field point. Re-check the visible layers, current tenure and access context before planning a visit.",
      chips: ["Saved target", "Check tenure", "Check access"]
    }, item);
    if (item.score) selectTarget(savedItem);
    else { customPoint = savedItem; activeTarget = null; renderInsight(savedItem); }
    showToast("Centered on saved target");
  }

  function renderLocation(location) {
    $("areaName").textContent = location.name;
    $("areaMeta").textContent = location.meta + " · " + (map ? viewDistance(map.getZoom()) : "11 km view");
    $("mapTitle").textContent = location.name;
    $("mapSubtitle").textContent = "Model preview · " + (map ? viewDistance(map.getZoom()) : "11 km view");
    $("coordinateReadout").textContent = formatCoordinate(location.coords[0], location.coords[1]);
  }

  function chooseLocation(location) {
    currentLocation = location;
    state.areaId = location.id;
    customPoint = null;
    if (map) {
      map.setView(location.coords, location.zoom);
      rebuildSignalLayer();
      var targets = getTargets(location.coords);
      selectTarget(targets[0]);
    }
    renderLocation(location);
    saveState();
    showToast("Centered on " + location.short);
  }

  function updateMapMeta() {
    if (!map) return;
    var center = map.getCenter();
    var label = currentLocation.name;
    $("areaMeta").textContent = formatCoordinate(center.lat, center.lng) + " · " + viewDistance(map.getZoom());
    $("mapSubtitle").textContent = "Model preview · " + viewDistance(map.getZoom());
    $("coordinateReadout").textContent = formatCoordinate(center.lat, center.lng);
    void label;
  }

  function viewDistance(zoom) {
    var km = Math.round(720 / Math.pow(2, Math.max(1, zoom - 5)));
    return Math.max(1, km) + " km view";
  }

  function updateCoordinate(latlng) { $("coordinateReadout").textContent = formatCoordinate(latlng.lat, latlng.lng); }
  function formatCoordinate(lat, lng) {
    var latHem = lat >= 0 ? "N" : "S";
    var lngHem = lng >= 0 ? "E" : "W";
    return Math.abs(lat).toFixed(2) + "° " + latHem + "  " + Math.abs(lng).toFixed(2) + "° " + lngHem;
  }
  function escapeHTML(value) { return String(value).replace(/[&<>'"]/g, function (char) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]; }); }

  function updateWeightsUI() {
    var weights = state.weights;
    $("faultWeight").value = weights.fault;
    $("drainageWeight").value = weights.drainage;
    $("goldWeight").value = weights.gold;
    $("faultValue").textContent = weights.fault + "%";
    $("drainageValue").textContent = weights.drainage + "%";
    $("goldValue").textContent = weights.gold + "%";
    var target = activeTarget || getTargets(currentLocation.coords)[0];
    var total = Number(weights.fault) + Number(weights.drainage) + Number(weights.gold);
    var score = Math.round((target.values[0] * Number(weights.fault) + target.values[1] * Number(weights.drainage) + target.values[2] * Number(weights.gold)) / Math.max(1, total));
    $("scorePreview").textContent = clamp(score, 1, 99);
    $("weightWarning").hidden = total > 0;
  }

  function runModel() {
    updateWeightsUI();
    rebuildSignalLayer();
    var target = activeTarget || getTargets(currentLocation.coords)[0];
    if (target) selectTarget(getTargets(currentLocation.coords).find(function (item) { return item.id === target.id; }) || getTargets(currentLocation.coords)[0]);
    saveState();
    showToast("Signal model refreshed for this area");
  }

  function openModal(title, html) {
    $("modalTitle").textContent = title;
    $("modalContent").innerHTML = html;
    $("modalBackdrop").hidden = false;
  }
  function closeModal() { $("modalBackdrop").hidden = true; }
  function showSourceModal(key) {
    var content = {
      basemap: ["Basemap sources", '<p>Satellite imagery is the latest publicly available Queensland imagery service. Topo is the Queensland Government topographic cache. Street view uses OpenStreetMap as a lightweight fallback reference.</p><ul class="source-list"><li><strong>Imagery:</strong> Queensland Department of Resources</li><li><strong>Topo:</strong> Queensland Department of Resources</li><li><strong>Street:</strong> OpenStreetMap contributors</li></ul>'],
      leases: ["Current mining leases", '<p>This layer is the granted <strong>ML permit</strong> sub-layer from Queensland’s current mines and permits service. The service says it is updated nightly. A rendered map layer is not a substitute for checking the live authority record.</p><p><a href="https://georesglobe.information.qld.gov.au/" target="_blank" rel="noopener">Verify in GeoResGlobe ↗</a></p>'],
      permits: ["Exploration permits", '<p>Shows granted mineral exploration permit areas (EPM) from the Queensland current permits service. It is included as a context layer so you can spot ground that needs a more careful tenure check.</p><p><a href="https://georesglobe.information.qld.gov.au/" target="_blank" rel="noopener">Open the authority viewer ↗</a></p>'],
      faults: ["Faults & shear zones", '<p>Detailed mapped faults and shear zones from the Queensland geology service. Structure can help frame a search, but a line on a regional map does not tell you where gold is or whether land is accessible.</p><p><a href="https://www.data.qld.gov.au/dataset/queensland-geology-series" target="_blank" rel="noopener">View Queensland geology data ↗</a></p>'],
      occurrences: ["Mineral occurrences", '<p>Known mineral resource sites and occurrences from the Geological Survey of Queensland. The layer is deliberately separate from the model so you can inspect the evidence instead of taking a score on trust.</p>'],
      geology: ["Host geology", '<p>State surface geology gives regional context for rock units and structure. It is not a gold prospectivity map. Use it alongside field observations and the original GSQ data.</p>'],
      geophysics: ["Magnetic response", '<p>This is the Queensland magnetic image: a regional airborne geophysics layer that can reveal broad changes in rock properties and help frame structural questions.</p><p>It is not a metal detector and should never be interpreted without its scale, survey history and the rest of the geology.</p>'],
      roads: ["Roads & access context", '<p>Roads are reference-only. Track condition, gates, private property, native title, protected areas and access permissions still need to be checked on the ground and with the relevant authority.</p>'],
      signals: ["Prospecting signal", '<p>The beta signal combines three visible planning ideas: proximity to mapped structure, a drainage / low-slope setting proxy, and evidence from known mineral occurrences. Weights are adjustable in Scout plan.</p><p><strong>It is not a geological prediction, “magic scan”, or guarantee of gold.</strong> It is designed to reduce random driving and make your assumptions explicit.</p>']
    }[key] || ["About Gold Scout", "<p>A field planning prototype for Queensland prospectors.</p>"];
    openModal(content[0], content[1]);
  }

  function inspectActive() {
    var item = getActiveItem();
    var score = item.score ? '<div class="detail-score"><strong>' + item.score + '</strong><span>/100 model signal</span></div>' : "";
    openModal(item.title, '<p>' + escapeHTML(item.description) + '</p>' + score + '<ul class="source-list"><li><strong>Coordinates:</strong> ' + formatCoordinate(item.coords[0], item.coords[1]) + '</li><li><strong>Next check:</strong> current tenure and access status</li><li><strong>Field note:</strong> compare satellite, topo and what is actually visible on the ground</li></ul><p>Save this point to keep it in your field shortlist.</p>');
  }

  function shareMap() {
    var url = location.href.split("#")[0] + "#area=" + encodeURIComponent(currentLocation.id || DEFAULT_AREA);
    if (navigator.share) {
      navigator.share({ title: "Gold Scout field map", text: "A Queensland prospecting map I’m checking out", url: url }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () { showToast("Map link copied"); }, function () { fallbackCopy(url); });
    } else fallbackCopy(url);
  }
  function fallbackCopy(text) {
    var field = document.createElement("textarea");
    field.value = text; field.style.position = "fixed"; field.style.opacity = "0";
    document.body.appendChild(field); field.select();
    try { document.execCommand("copy"); showToast("Map link copied"); } catch (error) { window.prompt("Copy this map link", text); }
    document.body.removeChild(field);
  }

  function bindStaticUI() {
    document.querySelectorAll(".style-button").forEach(function (button) {
      button.addEventListener("click", function () { setBasemap(button.dataset.style, true); });
    });
    document.querySelectorAll(".layer-toggle").forEach(function (input) {
      input.addEventListener("change", function () { toggleLayer(input.dataset.layer, input.checked); saveState(); });
    });
    document.querySelectorAll(".layer-info").forEach(function (button) {
      button.addEventListener("click", function (event) { event.preventDefault(); event.stopPropagation(); showSourceModal(button.dataset.info); });
    });
    document.querySelectorAll(".side-tab").forEach(function (button) {
      button.addEventListener("click", function () {
        document.querySelectorAll(".side-tab").forEach(function (tab) { tab.classList.remove("active"); });
        document.querySelectorAll(".tab-panel").forEach(function (panel) { panel.classList.remove("active"); });
        button.classList.add("active");
        $(button.dataset.tab + "Tab").classList.add("active");
      });
    });
    $("saveTargetBtn").addEventListener("click", saveActiveTarget);
    $("inspectBtn").addEventListener("click", inspectActive);
    $("howItWorksBtn").addEventListener("click", function () { showSourceModal("signals"); });
    $("aboutBtn").addEventListener("click", function () {
      openModal("About Gold Scout", '<p>Gold Scout helps prospectors make a shorter, better-informed shortlist before a field day. It brings Queensland imagery, tenure, structure and mineral-occurrence context into one map.</p><ul class="source-list"><li><strong>Official context:</strong> Queensland Government map services</li><li><strong>Modelled layer:</strong> transparent client-side planning signal</li><li><strong>Remember:</strong> map context does not grant permission to enter or prospect</li></ul><p>Always confirm current information in GeoResGlobe and the relevant Queensland rules before you go.</p>');
    });
    $("profileBtn").addEventListener("click", function () { showToast("Profile and field kit coming next"); });
    $("shareBtn").addEventListener("click", shareMap);
    $("locateBtn").addEventListener("click", function () {
      if (!map || !navigator.geolocation) { showToast("Location is not available in this browser"); return; }
      showToast("Requesting your location…");
      map.locate({ setView: true, maxZoom: 13, enableHighAccuracy: true });
      map.once("locationfound", function (event) {
        L.marker(event.latlng, { icon: L.divIcon({ className: "user-pin-icon", html: '<div class="user-marker"></div>', iconSize: [15, 15], iconAnchor: [7, 7] }) }).addTo(map).bindTooltip("Your location").openTooltip();
        updateCoordinate(event.latlng); showToast("Centered on your location");
      });
      map.once("locationerror", function () { showToast("Couldn’t access location — check browser permission"); });
    });
    $("resetViewBtn").addEventListener("click", function () { chooseLocation(getLocation(state.areaId)); });
    $("zoomInBtn").addEventListener("click", function () { if (map) map.zoomIn(); });
    $("zoomOutBtn").addEventListener("click", function () { if (map) map.zoomOut(); });
    $("fullscreenBtn").addEventListener("click", function () {
      var stage = document.querySelector(".map-stage");
      if (!document.fullscreenElement && stage.requestFullscreen) stage.requestFullscreen();
      else if (document.exitFullscreen) document.exitFullscreen();
      setTimeout(function () { if (map) map.invalidateSize(); }, 300);
    });
    $("closeInsight").addEventListener("click", function () { $("mapInsight").classList.add("hidden"); });
    $("legendToggle").addEventListener("click", function () { $("legendItems").classList.toggle("collapsed"); $("legendToggle").textContent = $("legendItems").classList.contains("collapsed") ? "⌃" : "⌄"; });
    $("modalClose").addEventListener("click", closeModal);
    $("modalBackdrop").addEventListener("click", function (event) { if (event.target === $("modalBackdrop")) closeModal(); });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { closeModal(); $("mapInsight").classList.remove("hidden"); }
      if (event.key === "/" && document.activeElement.tagName !== "INPUT") { event.preventDefault(); $("locationSearch").focus(); }
    });

    ["fault", "drainage", "gold"].forEach(function (key) {
      var input = $(key === "fault" ? "faultWeight" : key === "drainage" ? "drainageWeight" : "goldWeight");
      input.addEventListener("input", function () {
        state.weights[key] = Number(input.value);
        updateWeightsUI();
        if (activeTarget) {
          var updated = getTargets(currentLocation.coords).find(function (item) { return item.id === activeTarget.id; });
          if (updated) selectTarget(updated);
        }
      });
    });
    $("runModelBtn").addEventListener("click", runModel);

    var search = $("locationSearch");
    search.addEventListener("input", function () { renderSearchResults(search.value); });
    search.addEventListener("focus", function () { renderSearchResults(search.value); });
    document.addEventListener("click", function (event) {
      if (!event.target.closest(".search-block")) $("searchResults").hidden = true;
    });
    renderSearchResults("");
    $("searchResults").hidden = true;

    var hash = location.hash.match(/#area=([^&]+)/);
    if (hash) {
      var sharedArea = getLocation(decodeURIComponent(hash[1]));
      if (sharedArea) { state.areaId = sharedArea.id; currentLocation = sharedArea; }
      history.replaceState(null, "", location.pathname + location.search);
    }
    updateLayerCount();
  }

  function renderSearchResults(query) {
    var results = $("searchResults");
    var clean = String(query || "").trim().toLowerCase();
    var matches = LOCATIONS.filter(function (item) { return !clean || (item.name + " " + item.short).toLowerCase().includes(clean); }).slice(0, 5);
    results.innerHTML = "";
    matches.forEach(function (item) {
      var button = document.createElement("button");
      button.className = "result-item";
      button.innerHTML = "<strong>⌖ &nbsp;" + escapeHTML(item.name) + "</strong><small>Queensland · " + escapeHTML(item.meta) + "</small>";
      button.addEventListener("click", function () { $("locationSearch").value = item.short; results.hidden = true; chooseLocation(item); });
      results.appendChild(button);
    });
    results.hidden = false;
  }

  // Start after the DOM exists. This file is deliberately safe to load at the end of body too.
  init();
})();