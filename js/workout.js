(function () {
  "use strict";

  const PLATE_COUNT = 10;
  const PLATE_KG = 10;
  const MIN_WEIGHT = 10;
  const MAX_WEIGHT = PLATE_COUNT * PLATE_KG;
  const JSON_PATH = "data.json";
  const JSON_POLL_MS = 100;
  const PLAN_STORAGE_KEY = "stack-workout-plan";
  const LOG_STORAGE_KEY = "stack-session-log";

  // ---------- state ----------
  let plan = [];               // [{ exercise, target }]
  let currentIndex = 0;
  let weight = 50;
  let running = false;
  let pollId = null;
  let timerId = null;
  let baselineReps = 0;        // data.reps value captured when Start was pressed
  let startTime = null;
  let elapsedMs = 0;
  let lastAvgTempo = null;     // most recent avgTempoSeconds seen from data.json this exercise

  // ---------- dom: planner ----------
  const plannerView = document.getElementById("plannerView");
  const runnerView = document.getElementById("runnerView");
  const workoutDoneView = document.getElementById("workoutDoneView");
  const pageFootnote = document.getElementById("pageFootnote");

  const exerciseSelect = document.getElementById("exerciseSelect");
  const repsTargetInput = document.getElementById("repsTargetInput");
  const weightInput = document.getElementById("weightInput");
  const addExerciseBtn = document.getElementById("addExerciseBtn");
  const planListEl = document.getElementById("planList");
  const planEmptyNote = document.getElementById("planEmptyNote");
  const planCountLabel = document.getElementById("planCountLabel");
  const startWorkoutBtn = document.getElementById("startWorkoutBtn");
  const backToPlannerBtn = document.getElementById("backToPlannerBtn");

  // ---------- dom: runner ----------
  const runnerProgressCount = document.getElementById("runnerProgressCount");
  const runnerExerciseName = document.getElementById("runnerExerciseName");
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
  const repsTargetNumEl = document.getElementById("repsTargetNum");
  const timeLabelEl = document.getElementById("timeLabel");
  const tempoLabelEl = document.getElementById("tempoLabel");
  const startBtn = document.getElementById("startBtn");
  const completionNoteEl = document.getElementById("completionNote");
  const weightLockNote = document.getElementById("weightLockNote");

  // ================= PLANNER =================

  // ---------- persistence: keep the plan across reloads ----------
  function savePlanToStorage() {
    try {
      localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plan));
    } catch (err) {
      // storage can fail (private browsing, quota, etc.) — plan still
      // works for the current session, it just won't survive a reload
      console.warn("Could not save plan to local storage:", err);
    }
  }

  function loadPlanFromStorage() {
    try {
      const raw = localStorage.getItem(PLAN_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        plan = parsed.filter(
          (item) =>
            item &&
            typeof item.exercise === "string" &&
            typeof item.target === "number" &&
            typeof item.weight === "number"
        );
      }
    } catch (err) {
      console.warn("Could not load saved plan:", err);
    }
  }

  // ---------- persistence: completed-set history, used by the Statistics page ----------
  function logCompletedSet(entry) {
    try {
      const raw = localStorage.getItem(LOG_STORAGE_KEY);
      const log = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(log) ? log : [];
      list.push(entry);
      // cap history length so localStorage doesn't grow unbounded forever
      const trimmed = list.length > 1000 ? list.slice(list.length - 1000) : list;
      localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(trimmed));
    } catch (err) {
      console.warn("Could not log completed set:", err);
    }
  }

  function renderPlan() {
    planListEl.innerHTML = "";
    plan.forEach((item, i) => {
      const li = document.createElement("li");
      li.className = "plan-item";
      li.innerHTML =
        '<div class="plan-item-info">' +
          '<span class="plan-item-num">' + String(i + 1).padStart(2, "0") + "</span>" +
          '<span class="plan-item-dot" style="background:' + (item.accent || DEFAULT_ACCENT) + '"></span>' +
          '<span class="plan-item-name">' + item.exercise + "</span>" +
          '<span class="plan-item-reps">' + item.target + " reps · " + item.weight + " kg</span>" +
        "</div>" +
        '<button type="button" class="plan-item-remove" data-index="' + i + '" aria-label="Remove">&times;</button>';
      planListEl.appendChild(li);
    });

    planEmptyNote.hidden = plan.length > 0;
    planCountLabel.textContent = plan.length + (plan.length === 1 ? " exercise" : " exercises");
    startWorkoutBtn.disabled = plan.length === 0;

    planListEl.querySelectorAll(".plan-item-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        plan.splice(Number(btn.dataset.index), 1);
        renderPlan();
        savePlanToStorage();
      });
    });
  }

  // fallback in case a plan saved before this feature existed is loaded
  // without an accent value, or an exercise name doesn't match any option
  const DEFAULT_ACCENT = "#d7f238";

  addExerciseBtn.addEventListener("click", () => {
    const target = Math.max(1, Math.min(99, parseInt(repsTargetInput.value, 10) || 10));
    const planWeight = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, parseInt(weightInput.value, 10) || 50));
    const accent = exerciseSelect.selectedOptions[0].dataset.accent || DEFAULT_ACCENT;
    plan.push({ exercise: exerciseSelect.value, target, weight: planWeight, accent });
    renderPlan();
    savePlanToStorage();
  });

  startWorkoutBtn.addEventListener("click", () => {
    if (plan.length === 0) return;
    currentIndex = 0;
    plannerView.hidden = true;
    workoutDoneView.hidden = true;
    runnerView.hidden = false;
    document.body.classList.add("runner-active");
    loadExercise(currentIndex);
  });

  backToPlannerBtn.addEventListener("click", () => {
    plan = [];
    savePlanToStorage();
    renderPlan();
    workoutDoneView.hidden = true;
    plannerView.hidden = false;
    document.body.classList.remove("runner-active");
  });

  // ================= WEIGHT STACK (manual — not read from JSON) =================

  for (let i = 0; i < PLATE_COUNT; i++) {
    const p = document.createElement("div");
    p.className = "plate";
    platesEl.appendChild(p);
  }
  const plateEls = Array.from(platesEl.children);

  function renderWeight() {
    weightNumEl.textContent = weight;
    const level = weight / PLATE_KG;
    plateEls.forEach((p, i) => p.classList.toggle("on", i < level));
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
    weight = Math.min(MAX_WEIGHT, weight + PLATE_KG);
    renderWeight();
  });
  weightDownBtn.addEventListener("click", () => {
    weight = Math.max(MIN_WEIGHT, weight - PLATE_KG);
    renderWeight();
  });
  window.addEventListener("resize", () => { if (!runnerView.hidden) renderWeight(); });

  // ================= REPS DIGITS =================

  function renderReps(count) {
    const str = String(Math.max(0, count)).padStart(2, "0").slice(-2);
    digit1El.textContent = str[0];
    digit2El.textContent = str[1];
  }

  function bumpDigits() {
    [digit1El, digit2El].forEach((d) => {
      d.classList.remove("bump");
      void d.offsetWidth;
      d.classList.add("bump");
    });
  }

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

  // ================= EXERCISE LOADING / RUNNING =================

  function loadExercise(index) {
    const ex = plan[index];
    document.documentElement.style.setProperty("--accent", ex.accent || DEFAULT_ACCENT);
    runnerProgressCount.textContent = "Exercise " + (index + 1) + " of " + plan.length;
    runnerExerciseName.textContent = ex.exercise;
    repsTargetNumEl.textContent = ex.target;
    renderReps(0);
    romNumEl.textContent = "0";
    fillEl.style.height = "0%";
    carriageEl.style.bottom = "-5px";
    timeLabelEl.textContent = "00:00";
    tempoLabelEl.textContent = "—";
    elapsedMs = 0;
    lastAvgTempo = null;
    completionNoteEl.hidden = true;
    startBtn.hidden = false;
    startBtn.disabled = false;
    startBtn.textContent = "Start Exercise";

    // weight is set by the plan, not the live stepper — lock it in place
    weight = ex.weight;
    renderWeight();
    weightUpBtn.disabled = true;
    weightDownBtn.disabled = true;
    weightLockNote.hidden = false;
  }

  async function pollOnce() {
    try {
      const res = await fetch(JSON_PATH + "?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (err) {
      return null;
    }
  }

  async function pollLoop() {
    const data = await pollOnce();
    if (data) {
      if (typeof data.pullPercent === "number") {
        const pct = Math.max(0, Math.min(100, data.pullPercent));
        romNumEl.textContent = Math.round(pct);
        fillEl.style.height = pct + "%";
        carriageEl.style.bottom = "calc(" + pct + "% - 5px)";
      }
      if (typeof data.avgTempoSeconds === "number") {
        lastAvgTempo = data.avgTempoSeconds;
        tempoLabelEl.textContent = data.avgTempoSeconds.toFixed(1) + "s / rep";
      }
      if (typeof data.reps === "number") {
        const repsThisExercise = Math.max(0, data.reps - baselineReps);
        const target = plan[currentIndex].target;
        const clamped = Math.min(repsThisExercise, target);
        if (clamped !== Number(digit1El.textContent + digit2El.textContent)) {
          renderReps(clamped);
          bumpDigits();
        }
        if (repsThisExercise >= target) {
          finishExercise();
          return;
        }
      }
    }
    if (running) pollId = setTimeout(pollLoop, JSON_POLL_MS);
  }

  async function startExercise() {
    running = true;
    startBtn.disabled = true;
    startBtn.textContent = "Running…";
    startTime = Date.now();
    timerId = setInterval(tickTimer, 250);

    const data = await pollOnce();
    baselineReps = data && typeof data.reps === "number" ? data.reps : 0;

    pollLoop();
  }

  function stopPolling() {
    running = false;
    clearTimeout(pollId);
    clearInterval(timerId);
  }

  function finishExercise() {
    stopPolling();
    renderReps(plan[currentIndex].target);
    startBtn.hidden = true;
    completionNoteEl.hidden = false;

    // use a fresh Date.now() rather than the last tickTimer value, since
    // the 250ms tick could be up to a quarter-second stale at the exact
    // moment the target rep count is reached
    const finalElapsedMs = startTime !== null ? Date.now() - startTime : elapsedMs;

    const finished = plan[currentIndex];
    logCompletedSet({
      exercise: finished.exercise,
      weight: finished.weight,
      reps: finished.target,
      avgTempo: lastAvgTempo,
      timeSeconds: Math.round(finalElapsedMs / 1000),
      timestamp: Date.now(),
    });

    const isLast = currentIndex >= plan.length - 1;
    completionNoteEl.textContent = isLast
      ? "Exercise complete — finishing up…"
      : "Exercise complete — loading next";

    setTimeout(() => {
      if (isLast) {
        runnerView.hidden = true;
        document.body.classList.remove("runner-active");
        workoutDoneView.hidden = false;
      } else {
        currentIndex += 1;
        loadExercise(currentIndex);
      }
    }, 1400);
  }

  startBtn.addEventListener("click", () => {
    if (!running) startExercise();
  });

  // ---------- init ----------
  loadPlanFromStorage();
  renderPlan();
})();