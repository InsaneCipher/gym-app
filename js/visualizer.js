(function () {
  "use strict";

  // ---------- config ----------
  const PLATE_COUNT = 10;      // 10 plates x 10 lbs = 100 lb stack
  const PLATE_LB = 10;
  const MIN_WEIGHT = 10;
  const MAX_WEIGHT = PLATE_COUNT * PLATE_LB;
  const CYCLE_MS_BASE = 2400;  // baseline time for one full rep (down+up)

  // ---------- state ----------
  let weight = 50;
  let running = false;
  let reps = 0;
  let startTime = null;
  let elapsedMs = 0;
  let cycleStart = null;
  let lastPhaseWrapped = false;
  let repDurations = [];
  let currentHandle = "Lat Pulldown";
  let rafId = null;
  let timerId = null;

  // ---------- dom ----------
  const platesEl = document.getElementById("plates");
  const pinEl = document.getElementById("pin");
  const weightNumEl = document.getElementById("weightNum");
  const weightUpBtn = document.getElementById("weightUp");
  const weightDownBtn = document.getElementById("weightDown");
  const fillEl = document.getElementById("fill");
  const carriageEl = document.getElementById("carriage");
  const romNumEl = document.getElementById("romNum");
  const digit1El = document.getElementById("digit1");
  const digit2El = document.getElementById("digit2");
  const handleLabelEl = document.getElementById("handleLabel");
  const timeLabelEl = document.getElementById("timeLabel");
  const tempoLabelEl = document.getElementById("tempoLabel");
  const startBtn = document.getElementById("startBtn");
  const resetBtn = document.getElementById("resetBtn");
  const handleSelect = document.getElementById("handleSelect");
  const modeSimBtn = document.getElementById("modeSim");
  const modeJsonBtn = document.getElementById("modeJson");
  const dataSourceNoteEl = document.getElementById("dataSourceNote");

  // ---------- build plates ----------
  for (let i = 0; i < PLATE_COUNT; i++) {
    const p = document.createElement("div");
    p.className = "plate";
    p.dataset.index = i;
    platesEl.appendChild(p);
  }
  const plateEls = Array.from(platesEl.children);

  function renderWeight() {
    weightNumEl.textContent = weight;
    const level = weight / PLATE_LB;
    plateEls.forEach((p, i) => {
      p.classList.toggle("on", i < level);
    });
    // position pin at the top of the highlighted plates; recomputed on every
    // render since the plate stack is centered and its width flexes with
    // viewport size, so we measure real rects rather than assuming left:0
    requestAnimationFrame(() => {
      const topPlateIndex = level - 1;
      const topPlateEl = plateEls[Math.max(topPlateIndex, 0)];
      const stackRect = document.getElementById("stackArea").getBoundingClientRect();
      const plateRect = topPlateEl.getBoundingClientRect();
      const platesRect = platesEl.getBoundingClientRect();
      const top = plateRect.top - stackRect.top + (level > 0 ? -1 : plateRect.height / 2);
      const left = (platesRect.left - stackRect.left) + platesRect.width + 18;
      pinEl.style.top = top + "px";
      pinEl.style.left = left + "px";
    });
  }

  weightUpBtn.addEventListener("click", () => {
    weight = Math.min(MAX_WEIGHT, weight + PLATE_LB);
    renderWeight();
  });
  weightDownBtn.addEventListener("click", () => {
    weight = Math.max(MIN_WEIGHT, weight - PLATE_LB);
    renderWeight();
  });

  // ---------- handle selection ----------
  function selectHandle(option) {
    currentHandle = option.value;
    const accent = option.dataset.accent;
    document.documentElement.style.setProperty("--accent", accent);
    handleLabelEl.textContent = currentHandle;
  }
  handleSelect.addEventListener("change", () => {
    selectHandle(handleSelect.selectedOptions[0]);
  });
  selectHandle(handleSelect.selectedOptions[0]);

  // ---------- rep digits ----------
  function renderReps() {
    const str = String(reps).padStart(2, "0").slice(-2);
    digit1El.textContent = str[0];
    digit2El.textContent = str[1];
  }

  function bumpDigits() {
    [digit1El, digit2El].forEach((d) => {
      d.classList.remove("bump");
      void d.offsetWidth; // restart animation
      d.classList.add("bump");
    });
  }

  // ---------- timer ----------
  function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const m = String(Math.floor(total / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return m + ":" + s;
  }

  function tickTimer() {
    if (!running) return;
    elapsedMs = Date.now() - startTime;
    timeLabelEl.textContent = formatTime(elapsedMs);
  }

  // ---------- simulation loop ----------
  // A little per-rep jitter so the pull isn't perfectly metronomic —
  // heavier artificial weight settles into a slightly slower, steadier tempo.
  function cyclePeriod() {
    const loadFactor = 1 + (weight - 50) / 260; // heavier = a bit slower
    const jitter = 0.9 + Math.random() * 0.2;
    return CYCLE_MS_BASE * loadFactor * jitter;
  }

  let currentPeriod = cyclePeriod();

  function loop(now) {
    if (!running) return;
    if (cycleStart === null) cycleStart = now;

    const elapsed = now - cycleStart;
    let phase = (elapsed % currentPeriod) / currentPeriod;

    // smooth 0 -> 100 -> 0 pull curve
    const pct = (1 - Math.cos(phase * 2 * Math.PI)) / 2 * 100;

    romNumEl.textContent = Math.round(pct);
    fillEl.style.height = pct + "%";
    carriageEl.style.bottom = "calc(" + pct + "% - 5px)";

    // detect a completed cycle (phase wraps from ~1 back to ~0)
    const wrapped = elapsed >= currentPeriod;
    if (wrapped && !lastPhaseWrapped) {
      reps++;
      renderReps();
      bumpDigits();
      repDurations.push(currentPeriod);
      if (repDurations.length > 8) repDurations.shift();
      const avg = repDurations.reduce((a, b) => a + b, 0) / repDurations.length;
      tempoLabelEl.textContent = (avg / 1000).toFixed(1) + "s / rep";

      cycleStart = now;
      currentPeriod = cyclePeriod();
      lastPhaseWrapped = false;
    } else {
      lastPhaseWrapped = wrapped;
    }

    rafId = requestAnimationFrame(loop);
  }

  // ---------- controls ----------
  function startSet() {
    running = true;
    startTime = Date.now() - elapsedMs;
    cycleStart = null;
    startBtn.textContent = "Pause";
    startBtn.classList.remove("primary");
    timerId = setInterval(tickTimer, 250);
    rafId = requestAnimationFrame(loop);
  }

  function pauseSet() {
    running = false;
    startBtn.textContent = "Resume";
    startBtn.classList.add("primary");
    clearInterval(timerId);
    cancelAnimationFrame(rafId);
  }

  function resetSet() {
    running = false;
    reps = 0;
    elapsedMs = 0;
    cycleStart = null;
    repDurations = [];
    clearInterval(timerId);
    cancelAnimationFrame(rafId);
    renderReps();
    romNumEl.textContent = "0";
    fillEl.style.height = "0%";
    carriageEl.style.bottom = "-5px";
    timeLabelEl.textContent = "00:00";
    tempoLabelEl.textContent = "—";
    startBtn.textContent = "Start Set";
    startBtn.classList.add("primary");
  }

  startBtn.addEventListener("click", () => {
    if (running) {
      pauseSet();
    } else {
      startSet();
    }
  });

  resetBtn.addEventListener("click", resetSet);

  // ---------- data source: simulated vs. JSON file ----------
  // Later this points at whatever file the ESP32 keeps overwriting.
  // For now it just polls a static data.json sitting next to this page.
  const JSON_PATH = "data.json";
  const JSON_POLL_MS = 800;

  let dataMode = "sim"; // "sim" | "json"
  let jsonPollId = null;

  function setControlsEnabled(enabled) {
    [weightUpBtn, weightDownBtn, startBtn, resetBtn].forEach((btn) => {
      btn.disabled = !enabled;
    });
  }

  function setNote(text, isError) {
    dataSourceNoteEl.textContent = text;
    dataSourceNoteEl.classList.toggle("error", !!isError);
  }

  // Applies whatever fields are present in the JSON — missing fields are
  // just left alone, so a partial file (e.g. only "reps") still works.
  function applyJsonData(data) {
    if (typeof data.weight === "number") {
      weight = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, data.weight));
      renderWeight();
    }
    if (typeof data.pullPercent === "number") {
      const pct = Math.max(0, Math.min(100, data.pullPercent));
      romNumEl.textContent = Math.round(pct);
      fillEl.style.height = pct + "%";
      carriageEl.style.bottom = "calc(" + pct + "% - 5px)";
    }
    if (typeof data.reps === "number") {
      reps = data.reps;
      renderReps();
    }
    if (typeof data.setTimeSeconds === "number") {
      timeLabelEl.textContent = formatTime(data.setTimeSeconds * 1000);
    }
    if (typeof data.avgTempoSeconds === "number") {
      tempoLabelEl.textContent = data.avgTempoSeconds.toFixed(1) + "s / rep";
    }
  }

  async function pollJson() {
    try {
      // cache: "no-store" + a cache-busting query param, since the whole
      // point is reading a file that keeps changing underneath us
      const res = await fetch(JSON_PATH + "?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      applyJsonData(data);
      const stamp = new Date().toLocaleTimeString();
      setNote("Reading " + JSON_PATH + " — last updated " + stamp, false);
    } catch (err) {
      setNote("Could not read " + JSON_PATH + " (" + err.message + ")", true);
    }
  }

  function switchToJsonMode() {
    if (dataMode === "json") return;
    dataMode = "json";
    // stop any running simulation loop without touching its button label,
    // since controls get disabled below anyway
    running = false;
    clearInterval(timerId);
    cancelAnimationFrame(rafId);
    setControlsEnabled(false);
    modeJsonBtn.classList.add("active");
    modeSimBtn.classList.remove("active");
    pollJson();
    jsonPollId = setInterval(pollJson, JSON_POLL_MS);
  }

  function switchToSimMode() {
    if (dataMode === "sim") return;
    dataMode = "sim";
    clearInterval(jsonPollId);
    jsonPollId = null;
    setControlsEnabled(true);
    setNote("", false);
    modeSimBtn.classList.add("active");
    modeJsonBtn.classList.remove("active");
  }

  modeSimBtn.addEventListener("click", switchToSimMode);
  modeJsonBtn.addEventListener("click", switchToJsonMode);

  // ---------- init ----------
  renderWeight();
  renderReps();
  tempoLabelEl.textContent = "—";
  window.addEventListener("resize", renderWeight);
})();