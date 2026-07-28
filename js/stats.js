(function () {
  "use strict";

  const LOG_STORAGE_KEY = "stack-session-log";

  // same exercise -> color mapping used on the Workout Plan page, so a
  // given exercise always reads as the same color everywhere in the app
  const EXERCISE_ACCENTS = {
    "Lat Pulldown": "#3e7bd6",
    "Seated Row": "#3e7bd6",
    "Chest Press": "#d6452c",
    "Leg Extension": "#47a56b",
    "Shoulder Press": "#dcb400",
  };
  const DEFAULT_ACCENT = "#d7f238";

  const summaryRow = document.getElementById("summaryRow");
  const emptyState = document.getElementById("emptyState");
  const statsGrid = document.getElementById("statsGrid");
  const clearStatsBtn = document.getElementById("clearStatsBtn");

  function loadLog() {
    try {
      const raw = localStorage.getItem(LOG_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn("Could not read session log:", err);
      return [];
    }
  }

  // rounds to the nearest 10 (e.g. 46 -> 50, 44 -> 40), matching the
  // plate system's 10kg increments
  function roundToTen(n) {
    return Math.round(n / 10) * 10;
  }

  // formats a whole number of seconds as "1h 12m", "12m 34s", or "45s" —
  // whichever units are actually non-zero, so a 20-second set doesn't
  // print as "0h 0m 20s"
  function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return h + "h " + m + "m";
    if (m > 0) return m + "m " + sec + "s";
    return sec + "s";
  }

  function aggregate(log) {
    const byExercise = {};

    log.forEach((entry) => {
      if (!entry || typeof entry.exercise !== "string") return;
      if (!byExercise[entry.exercise]) {
        byExercise[entry.exercise] = {
          exercise: entry.exercise,
          totalReps: 0,
          totalTimeSeconds: 0,
          weights: [],
          tempos: [],
          setsCompleted: 0,
        };
      }
      const bucket = byExercise[entry.exercise];
      if (typeof entry.reps === "number") bucket.totalReps += entry.reps;
      if (typeof entry.timeSeconds === "number") bucket.totalTimeSeconds += entry.timeSeconds;
      if (typeof entry.weight === "number") bucket.weights.push(entry.weight);
      if (typeof entry.avgTempo === "number") bucket.tempos.push(entry.avgTempo);
      bucket.setsCompleted += 1;
    });

    return Object.values(byExercise)
      .map((b) => {
        const avgWeight = b.weights.length
          ? roundToTen(b.weights.reduce((a, v) => a + v, 0) / b.weights.length)
          : 0;
        const highestWeight = b.weights.length ? Math.max(...b.weights) : 0;
        const avgTempo = b.tempos.length
          ? b.tempos.reduce((a, v) => a + v, 0) / b.tempos.length
          : null;
        return {
          exercise: b.exercise,
          totalReps: b.totalReps,
          totalTimeSeconds: b.totalTimeSeconds,
          avgWeight,
          highestWeight,
          avgTempo,
          setsCompleted: b.setsCompleted,
        };
      })
      .sort((a, b) => b.totalReps - a.totalReps);
  }

  function render() {
    const log = loadLog();

    if (log.length === 0) {
      summaryRow.innerHTML = "";
      emptyState.hidden = false;
      statsGrid.innerHTML = "";
      return;
    }
    emptyState.hidden = true;

    const stats = aggregate(log);
    const totalSets = log.length;
    const totalReps = stats.reduce((a, s) => a + s.totalReps, 0);
    const totalTimeSeconds = stats.reduce((a, s) => a + s.totalTimeSeconds, 0);

    summaryRow.innerHTML =
      '<span class="summary-chip"><strong>' + totalSets + "</strong> sets completed</span>" +
      '<span class="summary-chip"><strong>' + totalReps + "</strong> total reps</span>" +
      '<span class="summary-chip"><strong>' + formatDuration(totalTimeSeconds) + "</strong> total time</span>" +
      '<span class="summary-chip"><strong>' + stats.length + "</strong> exercises tracked</span>";

    statsGrid.innerHTML = stats
      .map((s) => {
        const accent = EXERCISE_ACCENTS[s.exercise] || DEFAULT_ACCENT;
        const speedText = s.avgTempo !== null ? s.avgTempo.toFixed(1) + "s / rep" : "—";
        return (
          '<div class="stat-card">' +
            '<div class="stat-card-header">' +
              '<span class="stat-dot" style="background:' + accent + '"></span>' +
              '<span class="stat-card-name">' + s.exercise + "</span>" +
            "</div>" +
            '<div class="stat-row"><span>Total Reps</span><span>' + s.totalReps + "</span></div>" +
            '<div class="stat-row"><span>Total Time</span><span>' + formatDuration(s.totalTimeSeconds) + "</span></div>" +
            '<div class="stat-row"><span>Average Weight</span><span>' + s.avgWeight + " kg</span></div>" +
            '<div class="stat-row"><span>Highest Weight</span><span>' + s.highestWeight + " kg</span></div>" +
            '<div class="stat-row"><span>Average Speed</span><span>' + speedText + "</span></div>" +
          "</div>"
        );
      })
      .join("");
  }

  clearStatsBtn.addEventListener("click", () => {
    if (!confirm("Clear all workout statistics? This can't be undone.")) return;
    localStorage.removeItem(LOG_STORAGE_KEY);
    render();
  });

  render();
})();