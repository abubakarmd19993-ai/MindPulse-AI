/* =========================================================
   MindPulse AI — script.js
   Vanilla JS: navigation, multi-step form, validation,
   FastAPI integration, results dashboard, export.
   ========================================================= */
(() => {
  "use strict";
 
  /* ---------------------------------------------------------
     1. CONFIGURATION — change these in one place
     --------------------------------------------------------- */
  const CONFIG = {
    API_BASE_URL: "http://127.0.0.1:8000", // your FastAPI server
    PREDICT_PATH: "/predict",
    DOCS_PATH: "/docs",
    REQUEST_TIMEOUT_MS: 15000,
    // The gauge needs *some* range to draw. The real range of your model's
    // output is not known to this frontend, so this is a DISPLAY-ONLY value.
    // Set it to your dataset's real maximum score once you've confirmed it.
    GAUGE_DISPLAY_MAX: 10,
  };
 
  /* Field definitions: names match the FastAPI StudentData schema exactly. */
  const FIELDS = [
    { name: "age",                     label: "Age",                       type: "int",    min: 10, max: 100, step: 1 },
    { name: "gender",                  label: "Gender",                    type: "choice" },
    { name: "country",                 label: "Country",                   type: "text" },
    { name: "academic_level",          label: "Academic level",            type: "choice" },
    { name: "most_used_platform",      label: "Most-used platform",        type: "choice" },
    { name: "purpose_of_use",          label: "Purpose of use",            type: "choice" },
    { name: "avg_daily_usage_hours",   label: "Average daily usage (h)",   type: "float",  min: 0, max: 24 },
    { name: "daily_unlocks",           label: "Daily phone unlocks",       type: "int",    min: 0 },
    { name: "study_hours",             label: "Study hours",               type: "float",  min: 0, max: 24 },
    { name: "physical_activity_hours", label: "Physical activity (h)",     type: "float",  min: 0, max: 24 },
    { name: "sleep_hours_per_night",   label: "Sleep per night (h)",       type: "float",  min: 0, max: 24 },
    { name: "stress_level",            label: "Stress level",              type: "choice" },
  ];
  const STEP_FIELDS = {
    1: ["age", "gender", "country", "academic_level"],
    2: ["most_used_platform", "purpose_of_use", "avg_daily_usage_hours", "daily_unlocks"],
    3: ["study_hours", "physical_activity_hours", "sleep_hours_per_night", "stress_level"],
  };
  const TOTAL_STEPS = 4; // 3 input steps + review
 
  const COUNTRIES = ["Afghanistan","Albania","Algeria","Argentina","Armenia","Australia","Austria","Azerbaijan","Bahrain","Bangladesh","Belarus","Belgium","Bhutan","Bolivia","Bosnia and Herzegovina","Brazil","Bulgaria","Cambodia","Canada","Chile","China","Colombia","Costa Rica","Croatia","Cuba","Cyprus","Czech Republic","Denmark","Ecuador","Egypt","Estonia","Ethiopia","Finland","France","Georgia","Germany","Ghana","Greece","Hong Kong","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Japan","Jordan","Kazakhstan","Kenya","Kuwait","Latvia","Lebanon","Lithuania","Malaysia","Maldives","Mexico","Morocco","Nepal","Netherlands","New Zealand","Nigeria","Norway","Oman","Pakistan","Peru","Philippines","Poland","Portugal","Qatar","Romania","Russia","Saudi Arabia","Singapore","Slovakia","Slovenia","South Africa","South Korea","Spain","Sri Lanka","Sweden","Switzerland","Taiwan","Thailand","Turkey","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan","Venezuela","Vietnam","Yemen"];
 
  /* ---------------------------------------------------------
     2. DOM HELPERS
     --------------------------------------------------------- */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
 
  const form        = $("#assessForm");
  const backBtn     = $("#backBtn");
  const nextBtn     = $("#nextBtn");
  const submitBtn   = $("#submitBtn");
  const barFill     = $("#barFill");
  const apiError    = $("#apiError");
  const apiErrorTtl = $("#apiErrorTitle");
  const apiErrorMsg = $("#apiErrorMsg");
  const resultsEl   = $("#results");
  const assessEl    = $(".assess");
 
  let currentStep = 1;
  let isSubmitting = false;
  let lastResult = null; // { payload, score, timestamp } — kept in memory only
 
  /* ---------------------------------------------------------
     3. NAVIGATION, THEME, REVEAL ANIMATIONS
     --------------------------------------------------------- */
  function initNav() {
    const toggle = $("#menuToggle");
    const links = $("#navLinks");
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
    links.addEventListener("click", (e) => {
      if (e.target.closest("a")) {
        links.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && links.classList.contains("is-open")) {
        links.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
    });
  }
 
  function initTheme() {
    const root = document.documentElement;
    const btn = $("#themeToggle");
    // Only the theme choice is stored — never assessment data.
    let saved = null;
    try { saved = localStorage.getItem("mindpulse-theme"); } catch (_) { /* storage blocked */ }
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    apply(saved || (prefersDark ? "dark" : "light"));
 
    btn.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      apply(next);
      try { localStorage.setItem("mindpulse-theme", next); } catch (_) { /* ignore */ }
    });
 
    function apply(theme) {
      root.dataset.theme = theme;
      btn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    }
  }
 
  function initReveal() {
    const items = $$(".reveal");
    if (!("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    items.forEach((el) => io.observe(el));
  }
 
  /* ---------------------------------------------------------
     4. FORM: STEPS, VALIDATION, REVIEW
     --------------------------------------------------------- */
  function fieldEl(name) { return document.getElementById(name); }
 
  function setError(name, message) {
    const input = fieldEl(name);
    const err = document.getElementById(`${name}-err`);
    const wrap = input.closest(".field");
    if (message) {
      err.textContent = message;
      wrap.classList.add("has-error");
      input.setAttribute("aria-invalid", "true");
    } else {
      err.textContent = "";
      wrap.classList.remove("has-error");
      input.removeAttribute("aria-invalid");
    }
  }
 
  /** Validate one field; returns an error string or "" when valid. */
  function validateField(def) {
    const raw = fieldEl(def.name).value.trim();
    if (raw === "") return `${def.label} is required.`;
 
    if (def.type === "int" || def.type === "float") {
      const n = Number(raw);
      if (!Number.isFinite(n)) return "Enter a valid number.";
      if (def.type === "int" && !Number.isInteger(n)) return "Enter a whole number.";
      if (def.min !== undefined && n < def.min) return `Must be at least ${def.min}.`;
      if (def.max !== undefined && n > def.max) return `Must be at most ${def.max}.`;
    }
    if (def.type === "text" && raw.length > 80) return "Please keep this under 80 characters.";
    return "";
  }
 
  function validateStep(step) {
    let firstBad = null;
    for (const name of STEP_FIELDS[step] || []) {
      const def = FIELDS.find((f) => f.name === name);
      const msg = validateField(def);
      setError(name, msg);
      if (msg && !firstBad) firstBad = name;
    }
    if (firstBad) fieldEl(firstBad).focus();
    return !firstBad;
  }
 
  function goToStep(step, { interactive = true } = {}) {
    currentStep = step;
    $$(".step").forEach((s) => s.classList.toggle("is-active", Number(s.dataset.step) === step));
    $$(".stepper__item").forEach((li) => {
      const n = Number(li.dataset.step);
      li.classList.toggle("is-active", n === step);
      li.classList.toggle("is-done", n < step);
      if (n === step) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    });
    barFill.style.width = `${(step / TOTAL_STEPS) * 100}%`;
 
    backBtn.hidden = step === 1;
    nextBtn.hidden = step === TOTAL_STEPS;
    submitBtn.hidden = step !== TOTAL_STEPS;
    if (step === TOTAL_STEPS) renderReview($("#reviewList"), buildPayload());
 
    hideApiError();
    if (!interactive) return; // initial render: don't steal focus or scroll the page
    // Move focus to the first control (or the legend on review) for keyboard/screen-reader users
    const active = $(`.step[data-step="${step}"]`);
    const target = active.querySelector("input, select") || active.querySelector("legend");
    if (target) { if (!target.hasAttribute("tabindex") && target.tagName === "LEGEND") target.tabIndex = -1; target.focus({ preventScroll: true }); }
    assessEl.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }
 
  /** Build the request body. Keys match the FastAPI StudentData schema exactly. */
  function buildPayload() {
    const payload = {};
    for (const def of FIELDS) {
      const raw = fieldEl(def.name).value.trim();
      if (def.type === "int" || def.type === "float") payload[def.name] = Number(raw);
      else payload[def.name] = raw;
    }
    return payload;
  }
 
  function renderReview(listEl, payload) {
    listEl.replaceChildren();
    for (const def of FIELDS) {
      const row = document.createElement("div");
      row.className = "review__row";
      const dt = document.createElement("dt");
      dt.textContent = def.label;
      const dd = document.createElement("dd");
      dd.textContent = String(payload[def.name]); // textContent: no HTML injection
      row.append(dt, dd);
      listEl.append(row);
    }
  }
 
  /* ---------------------------------------------------------
     5. API INTEGRATION
     --------------------------------------------------------- */
  function showApiError(title, message) {
    apiErrorTtl.textContent = title;
    apiErrorMsg.textContent = message;
    apiError.hidden = false;
    apiError.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "nearest" });
  }
  function hideApiError() { apiError.hidden = true; }
 
  /** Turn a FastAPI 422 body ({detail: [{loc, msg}, ...]}) into readable text. */
  function formatValidationDetail(body) {
    const detail = body && body.detail;
    if (Array.isArray(detail)) {
      return detail
        .map((d) => {
          const field = Array.isArray(d.loc) ? d.loc.filter((p) => p !== "body").join(".") : "";
          return field ? `${field}: ${d.msg}` : d.msg;
        })
        .join(" • ");
    }
    if (typeof detail === "string") return detail;
    return "The server rejected the submitted values.";
  }
 
  async function requestPrediction(payload) {
    const url = CONFIG.API_BASE_URL.replace(/\/+$/, "") + CONFIG.PREDICT_PATH;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);
 
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === "AbortError") {
        throw new ApiError("Request timed out",
          `The server did not respond within ${CONFIG.REQUEST_TIMEOUT_MS / 1000} seconds. Check that FastAPI is running at ${CONFIG.API_BASE_URL}.`);
      }
      throw new ApiError("Cannot reach the server",
        `Could not connect to ${CONFIG.API_BASE_URL}. Make sure the backend is running (uvicorn main:app --reload). ` +
        "If it is running, the browser may be blocking the request because CORS is not enabled — see the README.");
    } finally {
      clearTimeout(timer);
    }
 
    // Parse body safely (it may not be JSON on a server crash)
    let body = null;
    try { body = await response.json(); } catch (_) { /* leave null */ }
 
    if (response.status === 422) {
      throw new ApiError("The server rejected the input (422)", formatValidationDetail(body));
    }
    if (response.status >= 500) {
      throw new ApiError(`Server error (${response.status})`,
        "The backend hit an internal error while predicting. Check the uvicorn terminal for the traceback.");
    }
    if (!response.ok) {
      throw new ApiError(`Request failed (${response.status})`,
        (body && typeof body.detail === "string" && body.detail) || "The server returned an unexpected status.");
    }
 
    // Validate the real response — never invent a score
    const raw = body && body.predicted_mental_health_score;
    const score = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    if (typeof score !== "number" || !Number.isFinite(score)) {
      throw new ApiError("Unexpected response",
        "The server replied, but the response did not contain a valid numeric “predicted_mental_health_score”.");
    }
    return score;
  }
 
  class ApiError extends Error {
    constructor(title, message) { super(message); this.title = title; }
  }
 
  async function onSubmit(e) {
    e.preventDefault();
    if (isSubmitting) return;
 
    // Re-validate every step before sending
    for (const step of [1, 2, 3]) {
      if (!validateStep(step)) { goToStep(step); return; }
    }
 
    const payload = buildPayload();
    setLoading(true);
    hideApiError();
    try {
      const score = await requestPrediction(payload);
      lastResult = { payload, score, timestamp: new Date() };
      showResults(lastResult);
    } catch (err) {
      if (err instanceof ApiError) showApiError(err.title, err.message);
      else showApiError("Unexpected error", "Something went wrong while processing the request.");
    } finally {
      setLoading(false);
    }
  }
 
  function setLoading(on) {
    isSubmitting = on;
    submitBtn.disabled = on;
    backBtn.disabled = on;
    submitBtn.classList.toggle("is-loading", on);
    submitBtn.setAttribute("aria-busy", String(on));
    $(".btn__text", submitBtn).textContent = on ? "Predicting…" : "Submit Assessment";
  }
 
  /* ---------------------------------------------------------
     6. RESULTS DASHBOARD
     --------------------------------------------------------- */
  const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 86;
 
  function showResults({ payload, score }) {
    renderReview($("#resultInputs"), payload);
    assessEl.hidden = true;
    resultsEl.hidden = false;
 
    const gauge = $("#gaugeValue");
    const max = CONFIG.GAUGE_DISPLAY_MAX;
    const fraction = Math.min(Math.max(score / max, 0), 1);
    gauge.style.strokeDasharray = GAUGE_CIRCUMFERENCE;
    gauge.style.strokeDashoffset = GAUGE_CIRCUMFERENCE;
 
    let note = `The gauge fill is a visual aid on a 0–${max} display scale set in script.js. It is not a threshold or a health category.`;
    if (score < 0 || score > max) note += ` This score falls outside that display range, so the gauge is capped.`;
    $("#gaugeNote").textContent = note;
 
    // Let layout settle, then animate
    requestAnimationFrame(() => requestAnimationFrame(() => {
      gauge.style.strokeDashoffset = GAUGE_CIRCUMFERENCE * (1 - fraction);
    }));
    animateNumber($("#scoreNumber"), score);
 
    resultsEl.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    resultsEl.focus({ preventScroll: true });
  }
 
  /** Count up to the real value, ending on the exact value rounded to 2 dp. */
  function animateNumber(el, target) {
    const final = target.toFixed(2);
    if (prefersReducedMotion()) { el.textContent = final; return; }
    const duration = 1400;
    const start = performance.now();
    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = (target * eased).toFixed(2);
      if (t < 1) requestAnimationFrame(frame); else el.textContent = final;
    }
    requestAnimationFrame(frame);
  }
 
  function resetAssessment() {
    form.reset();
    $$(".field").forEach((f) => f.classList.remove("has-error"));
    $$(".err").forEach((e) => (e.textContent = ""));
    lastResult = null;
    resultsEl.hidden = true;
    assessEl.hidden = false;
    $("#scoreNumber").textContent = "—";
    goToStep(1);
  }
 
  /* ---------------------------------------------------------
     7. EXPORT (generated locally in the browser)
     --------------------------------------------------------- */
  function download(filename, mime, content) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
 
  function stamp(d) { return d.toISOString().slice(0, 19).replace(/[:T]/g, "-"); }
 
  function downloadJson() {
    if (!lastResult) return;
    const { payload, score, timestamp } = lastResult;
    const out = {
      generated_at: timestamp.toISOString(),
      predicted_mental_health_score: score,
      inputs: payload,
      disclaimer: "Model prediction for educational purposes only. Not a clinical diagnosis.",
    };
    download(`mindpulse-result-${stamp(timestamp)}.json`, "application/json", JSON.stringify(out, null, 2));
  }
 
  function downloadText() {
    if (!lastResult) return;
    const { payload, score, timestamp } = lastResult;
    const lines = [
      "MindPulse AI — Prediction Result",
      `Generated: ${timestamp.toLocaleString()}`,
      "",
      `Predicted mental health score: ${score}`,
      "",
      "Submitted inputs:",
      ...FIELDS.map((f) => `  ${f.label}: ${payload[f.name]}`),
      "",
      "Disclaimer: This is a model prediction for educational purposes only.",
      "It is not a clinical diagnosis or a substitute for professional assessment.",
    ];
    download(`mindpulse-result-${stamp(timestamp)}.txt`, "text/plain", lines.join("\n"));
  }
 
  /* ---------------------------------------------------------
     8. MISC + INIT
     --------------------------------------------------------- */
  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
 
  function populateCountries() {
    const list = $("#countryList");
    COUNTRIES.forEach((c) => { const o = document.createElement("option"); o.value = c; list.append(o); });
  }
 
  function init() {
    initNav();
    initTheme();
    initReveal();
    populateCountries();
 
    $("#year").textContent = new Date().getFullYear();
    $("#docsLink").href = CONFIG.API_BASE_URL.replace(/\/+$/, "") + CONFIG.DOCS_PATH;
 
    nextBtn.addEventListener("click", () => { if (validateStep(currentStep)) goToStep(currentStep + 1); });
    backBtn.addEventListener("click", () => { if (currentStep > 1 && !isSubmitting) goToStep(currentStep - 1); });
    form.addEventListener("submit", onSubmit);
 
    // Enter key advances steps instead of submitting early
    form.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.tagName === "INPUT" && currentStep < TOTAL_STEPS) {
        e.preventDefault();
        nextBtn.click();
      }
    });
    // Clear a field's error as soon as the user fixes it
    form.addEventListener("input", (e) => {
      const def = FIELDS.find((f) => f.name === e.target.id);
      if (def && e.target.closest(".field").classList.contains("has-error") && !validateField(def)) setError(def.name, "");
    });
 
    $("#newBtn").addEventListener("click", resetAssessment);
    $("#printBtn").addEventListener("click", () => window.print());
    $("#downloadJsonBtn").addEventListener("click", downloadJson);
    $("#downloadTxtBtn").addEventListener("click", downloadText);
 
    goToStep(1, { interactive: false });
  }
 
  document.addEventListener("DOMContentLoaded", init);
})();
 