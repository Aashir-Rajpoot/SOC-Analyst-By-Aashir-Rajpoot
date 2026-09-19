/* SOC Operations Training Platform - application logic
   Classic script (no modules) so index.html runs from file:// as well as http. */
(function () {
  "use strict";

  /* ============================ constants ============================ */
  var KEY = "soc_ops_state_v2";
  var PASS = 70;                 // percent required to complete a level
  var HINT_MAX = 2;              // hints per rolling window
  var HINT_WINDOW = 24 * 3600 * 1000;
  var DECISIONS = [
    ["true_positive", "True Positive"],
    ["false_positive", "False Positive"],
    ["needs_escalation", "Needs Escalation"]
  ];
  var SEVERITIES = ["INFORMATIONAL", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

  var LEVELS = window.LEVELS || [];
  var BOOK = window.BOOK || [];
  var COMMANDS = window.COMMANDS || [];

  /* evaluation payload is kept encoded so answer keys are not readable
     alongside the questions in page source. */
  var EVAL = {};
  try {
    EVAL = JSON.parse(decodeURIComponent(escape(atob(window.EVAL_B64 || ""))));
  } catch (e) {
    try { EVAL = JSON.parse(atob(window.EVAL_B64 || "")); } catch (e2) { EVAL = {}; }
  }

  /* ============================ helpers ============================ */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function norm(s) {
    return String(s == null ? "" : s).toLowerCase()
      .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
      .replace(/\s+/g, " ").replace(/[.,;:!]+$/, "").trim();
  }
  function levelById(id) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === +id) return LEVELS[i];
    return null;
  }
  function keyFor(id) { return EVAL[String(id)] || null; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hhmm(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    return pad(Math.floor(s / 3600)) + ":" + pad(Math.floor(s / 60) % 60) + ":" + pad(s % 60);
  }
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* ============================ state ============================ */
  function fresh() {
    return {
      v: 2,
      analyst: { name: "", started: Date.now() },
      completed: {},
      work: {},
      hints: { used: [], revealed: {} },
      book: { read: [], unlockedOverride: false },
      admin: { hash: "", chapters: {}, log: [] },
      achievements: [],
      /* training-flow state: theory chapters read, knowledge-test result, guided-investigation progress */
      theory: {},   // levelId -> { read: [chapterId, ...] }
      quiz: {},     // levelId -> { passed, bestPct, attempts, set: [{id,options order...}], answers: {}, failedIds: [] }
      guided: {}    // levelId -> { done: bool, step: 0, seen: [stepId,...] }
    };
  }
  var state = fresh();
  var storageOK = true;

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var p = JSON.parse(raw);
      if (p && typeof p === "object") {
        var f = fresh();
        for (var k in f) if (p[k] !== undefined) f[k] = p[k];
        f.hints = f.hints || { used: [], revealed: {} };
        f.hints.used = f.hints.used || [];
        f.hints.revealed = f.hints.revealed || {};
        f.theory = f.theory || {};
        f.quiz = f.quiz || {};
        f.guided = f.guided || {};
        state = f;
      }
    } catch (e) {
      storageOK = false;
      console.warn("[soc] could not read saved progress:", e);
    }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) {
      storageOK = false;
      console.warn("[soc] could not save progress:", e);
      toast("Progress could not be saved (browser storage unavailable).");
    }
  }
  function work(id) {
    var k = String(id);
    if (!state.work[k]) state.work[k] = { answers: {}, picks: [], notes: "", decision: "", severity: "", recommend: "", report: {}, startedAt: 0 };
    return state.work[k];
  }
  function isDone(id) { return !!state.completed[String(id)]; }

  /* ---- admin overrides (Feature 2/3): read-only from this app's point of
     view, written by admin.html. Safe/soft - disabling a level never
     deletes its authored data, it just hides it as unavailable, and
     disabling a stage auto-passes its gate so the flow still works. ---- */
  function adminLevelDisabled(id) {
    try {
      var raw = localStorage.getItem("soc_admin_level_overrides_v1");
      if (!raw) return false;
      var o = JSON.parse(raw);
      return !!(o && o[String(id)] && o[String(id)].enabled === false);
    } catch (e) { return false; }
  }
  function adminSections() {
    try {
      var raw = localStorage.getItem("soc_admin_sections_v1");
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function sectionDisabled(name) { return adminSections()[name] === false; }

  function isUnlocked(id) { return (+id === 1 || isDone(+id - 1)) && !adminLevelDisabled(id); }
  function doneCount() {
    var n = 0;
    for (var i = 1; i <= 30; i++) if (isDone(i)) n++;
    return n;
  }
  function currentLevel() {
    for (var i = 1; i <= 30; i++) if (!isDone(i)) return i;
    return 30;
  }
  function bookUnlocked() { return doneCount() >= 30 || state.book.unlockedOverride === true; }

  /* ============================ training-flow: theory / quiz / guided ============================ */

  /* ---- theory chapters: authored on lv.chapters, else auto-built from lv.theory so every level has real chapters ---- */
  function chaptersFor(lv) {
    if (lv.chapters && lv.chapters.length) return lv.chapters;
    var t = lv.theory || {};
    return [
      { id: "auto1", title: "Chapter 1 - Concept", body: t.concept || "", example: "", lookFor: "", mistake: "", practical: "" },
      { id: "auto2", title: "Chapter 2 - SOC Analyst Isay Kyun Check Karta Hai", body: t.why || "", example: "", lookFor: "", mistake: "", practical: "" },
      { id: "auto3", title: "Chapter 3 - Data Mein Yeh Kaisa Dikhta Hai", body: "", example: "", lookFor: (t.look || []).join(" | "), mistake: "", practical: "" },
      { id: "auto4", title: "Chapter 4 - Common False Positives", body: "", example: "", lookFor: (t.fp || []).join(" | "), mistake: "Har suspicious-lagti activity ko True Positive maan lena bina authorization check kiye.", practical: "" },
      { id: "auto5", title: "Chapter 5 - Investigation Tips", body: "", example: "", lookFor: (t.tips || []).join(" | "), mistake: "", practical: "Ab Knowledge Test ke liye ready ho - 100% score chahiye is investigation ko unlock karne ke liye." }
    ];
  }
  function theoryState(id) {
    var k = String(id);
    if (!state.theory[k]) state.theory[k] = { read: [] };
    return state.theory[k];
  }
  function theoryDone(lv) {
    if (sectionDisabled("theory")) return true;
    var ch = chaptersFor(lv), ts = theoryState(lv.id);
    for (var i = 0; i < ch.length; i++) if (ts.read.indexOf(ch[i].id) === -1) return false;
    return ch.length > 0;
  }
  function markChapterRead(lv, chId) {
    var ts = theoryState(lv.id);
    if (ts.read.indexOf(chId) === -1) { ts.read.push(chId); save(); }
  }

  /* ---- knowledge test: authored on lv.quizBank (+ EVAL[id].quiz for correct answers), else auto-built from lv.questions ---- */
  function quizBankFor(lv) {
    if (lv.quizBank && lv.quizBank.length) {
      var keyRows = ((keyFor(lv.id) || {}).quiz) || [];
      var keyById = {}; keyRows.forEach(function (k) { keyById[k.id] = k; });
      return lv.quizBank.map(function (mq) {
        var k = keyById[mq.id] || {};
        return { id: mq.id, q: mq.q, options: mq.options, correct: k.correct, explain: k.explain || "" };
      });
    }
    /* auto-fallback: build simple MCQs out of the level's investigation questions so every
       level still has a working knowledge-test gate, even without hand-authored bank content. */
    var kq = {}; ((keyFor(lv.id) || {}).questions || []).forEach(function (k) { kq[k.id] = k; });
    return (lv.questions || []).map(function (q, i) {
      if (q.type === "choice" && q.options && q.options.length > 1) {
        var accept = (kq[q.id] && kq[q.id].accept) || [];
        var correctIdx = 0;
        for (var o = 0; o < q.options.length; o++) if (accept.indexOf(norm(q.options[o])) !== -1) { correctIdx = o; break; }
        return { id: "auto" + i, q: q.label, options: q.options, correct: correctIdx, explain: "Correct answer per the investigation answer key." };
      }
      var correctVal = ((kq[q.id] && kq[q.id].accept) || [""])[0] || "(see evidence)";
      var distractors = ["Not enough evidence to determine", "Cannot be identified from the logs", "None of the recorded evidence"];
      var opts = [correctVal].concat(distractors).slice(0, 4);
      /* shuffle deterministically-ish per question so correct option is not always first */
      var seed = (lv.id * 31 + i) % opts.length;
      var rot = opts.slice(seed).concat(opts.slice(0, seed));
      return { id: "auto" + i, q: q.label, options: rot, correct: rot.indexOf(correctVal), explain: "Correct answer per the investigation answer key." };
    });
  }
  function quizStateOf(id) {
    var k = String(id);
    if (!state.quiz[k]) state.quiz[k] = { passed: false, bestPct: 0, attempts: 0, set: null, answers: {} };
    return state.quiz[k];
  }
  function quizPassed(lv) { return sectionDisabled("quiz") || !!quizStateOf(lv.id).passed; }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function newQuizSet(lv) {
    var bank = quizBankFor(lv);
    var n = Math.min(10, bank.length);
    var picked = shuffle(bank).slice(0, n);
    var qs = quizStateOf(lv.id);
    qs.set = picked.map(function (mq) {
      var optOrder = shuffle(mq.options.map(function (_, idx) { return idx; }));
      return { id: mq.id, q: mq.q, options: optOrder.map(function (idx) { return mq.options[idx]; }), correctPos: optOrder.indexOf(mq.correct), explain: mq.explain };
    });
    qs.answers = {};
    save();
    return qs.set;
  }
  function currentQuizSet(lv) {
    var qs = quizStateOf(lv.id);
    return qs.set && qs.set.length ? qs.set : newQuizSet(lv);
  }
  function gradeQuizSet(lv) {
    var qs = quizStateOf(lv.id), set = qs.set || [];
    var correctCount = 0;
    var results = set.map(function (item) {
      var given = qs.answers[item.id];
      var ok = given !== undefined && +given === item.correctPos;
      if (ok) correctCount++;
      return { id: item.id, q: item.q, ok: ok, given: given, correctPos: item.correctPos, options: item.options, explain: item.explain };
    });
    var pct = set.length ? Math.round((correctCount / set.length) * 100) : 0;
    qs.attempts = (qs.attempts || 0) + 1;
    qs.bestPct = Math.max(qs.bestPct || 0, pct);
    if (pct === 100) qs.passed = true;
    save();
    return { pct: pct, correctCount: correctCount, total: set.length, results: results };
  }

  /* ---- guided investigation: authored on lv.guided, else auto-built teaching walkthrough from the level's own case/evidence/review ---- */
  function guidedFor(lv) {
    if (lv.guided && lv.guided.steps && lv.guided.steps.length) return lv.guided;
    var k = keyFor(lv.id) || {};
    var ev = lv.evidence || [];
    var steps = [
      { id: "ag1", title: "Step 1 - Alert Padho", type: "reveal", ask: "Case briefing parho: " + lv.case.brief, why: "Har investigation ka pehla kaam alert/briefing ko samajhna hai.", buttonLabel: "Show Me - Kya Dekhna Hai", reveal: (lv.theory && lv.theory.concept) || "Evidence ko dhyan se parho." },
      { id: "ag2", title: "Step 2 - Evidence Dekho", type: "reveal", ask: "Evidence set '" + (ev[0] ? ev[0].name : "evidence") + "' kholo aur pehli kuch rows parho.", why: (lv.theory && lv.theory.why) || "Raw evidence hamesha alert se zyada bharosay-mand hoti hai.", buttonLabel: "Show Me - Evidence Guide", reveal: (lv.theory && (lv.theory.look || []).join(" | ")) || "Har evidence set ko ghoor kar parho." },
      { id: "ag3", title: "Step 3 - False Positive Rule Out Karo", type: "reveal", ask: "Socho: kya yeh activity kisi authorized change/scan se explain ho sakti hai?", why: "Change calendar check karna False Positive ko jaldi rule out kar sakta hai.", buttonLabel: "Show Me - Common False Positives", reveal: (lv.theory && (lv.theory.fp || []).join(" | ")) || "Evidence mein authorized activity ke signs dhoondo." },
      { id: "ag4", title: "Step 4 - Decision Reasoning", type: "reveal", ask: "Ab socho: True Positive, False Positive, ya Needs Escalation?", why: "Yeh core analyst decision hai - evidence ke bina yeh decision nahi lena chahiye.", buttonLabel: "Show Me - Reasoning", reveal: k.review || "Evidence ko dobara ghoor kar apna decision socho." },
      { id: "ag5", title: "Step 5 - Notes aur Next Steps", type: "reveal", ask: "Socho tum apni analyst notes kaise likhoge.", why: "Achi notes agle analyst ko poori kahani samjha deti hain.", buttonLabel: "Show Me - Kya Hoga Agay", reveal: "Ab tum Real Investigation ke liye ready ho - wahan koi answer reveal nahi hoga, sab kuch khud investigate karna hoga." }
    ];
    return { title: "Guided Walkthrough - " + lv.title, brief: "Is level ke liye ek dedicated guided scenario abhi authored nahi hua - yeh ek teaching walkthrough hai isi case ki evidence par mabni.", case: lv.case, evidence: ev, steps: steps };
  }
  function guidedStateOf(id) {
    var k = String(id);
    if (!state.guided[k]) state.guided[k] = { done: false, step: 0, seen: [] };
    return state.guided[k];
  }
  function guidedDone(lv) { return sectionDisabled("guided") || !!guidedStateOf(lv.id).done; }

  /* ---- skill-based assessment breakdown, used on the case-result screen and the progress dashboard ---- */
  var SKILLS = ["Alert Triage", "Evidence Analysis", "Risk Assessment", "Escalation", "Documentation"];
  function classifySkill(label) {
    var l = (label || "").toLowerCase();
    if (l.indexOf("decision") !== -1 || l.indexOf("which alert") !== -1) return "Alert Triage";
    if (l.indexOf("severity") !== -1 || l.indexOf("risk") !== -1) return "Risk Assessment";
    if (l.indexOf("recommend") !== -1 || l.indexOf("escalat") !== -1) return "Escalation";
    if (l.indexOf("report") !== -1 || l.indexOf("note") !== -1) return "Documentation";
    return "Evidence Analysis";
  }
  function skillBreakdown(g) {
    var buckets = {}; SKILLS.forEach(function (s) { buckets[s] = { pts: 0, max: 0 }; });
    (g.items || []).forEach(function (i) {
      var s = classifySkill(i.label), pts = i.mark === "good" ? 1 : (i.mark === "part" ? 0.5 : 0);
      buckets[s].pts += pts; buckets[s].max += 1;
    });
    var out = {};
    SKILLS.forEach(function (s) { out[s] = buckets[s].max ? Math.round((buckets[s].pts / buckets[s].max) * 100) : null; });
    return out;
  }

  /* ---------- hints: 2 per rolling 24 hours, enforced on timestamps ---------- */
  function hintsUsedRecently() {
    var now = Date.now();
    state.hints.used = (state.hints.used || []).filter(function (t) { return now - t < HINT_WINDOW; });
    return state.hints.used.length;
  }
  function hintsLeft() { return Math.max(0, HINT_MAX - hintsUsedRecently()); }
  function nextHintAt() {
    hintsUsedRecently();
    if (state.hints.used.length < HINT_MAX) return 0;
    var oldest = Math.min.apply(null, state.hints.used);
    return oldest + HINT_WINDOW;
  }
  function hintRevealed(token) { return state.hints.revealed[token] === true; }
  function revealHint(token) {
    if (hintRevealed(token)) return true;
    if (hintsLeft() <= 0) return false;
    state.hints.used.push(Date.now());
    state.hints.revealed[token] = true;
    save();
    return true;
  }
  function hintCountdown() {
    var at = nextHintAt();
    if (!at) return "";
    return "Next hint available in " + hhmm(at - Date.now());
  }

  /* ============================ grading ============================ */
  function matchQuestion(q, raw) {
    var a = norm(raw);
    if (!a) return 0;
    var accept = (q.accept || []).map(norm);
    var i, t;
    if (q.type === "num") {
      var got = (a.match(/-?\d+(?:\.\d+)?/g) || []);
      for (i = 0; i < accept.length; i++) {
        var want = (accept[i].match(/-?\d+(?:\.\d+)?/) || [accept[i]])[0];
        if (got.indexOf(want) !== -1) return 1;
      }
      return 0;
    }
    if (q.type === "exact" || q.type === "choice") {
      for (i = 0; i < accept.length; i++) {
        t = accept[i];
        if (a === t) return 1;
        if (t.length >= 4 && a.indexOf(t) !== -1) return 1;
      }
      return 0;
    }
    /* keywords: any accepted phrasing counts; near-misses score half */
    var best = 0;
    for (i = 0; i < accept.length; i++) {
      t = accept[i];
      if (!t) continue;
      if (a.indexOf(t) !== -1) return 1;
      var words = t.split(" ").filter(function (w) { return w.length > 3; });
      if (words.length > 1) {
        var hit = 0;
        for (var w = 0; w < words.length; w++) if (a.indexOf(words[w]) !== -1) hit++;
        var ratio = hit / words.length;
        if (ratio === 1) return 1;
        if (ratio >= 0.6) best = Math.max(best, 0.5);
      }
    }
    return best;
  }

  function timelineScore(lv, picks) {
    var k = keyFor(lv.id);
    var want = (k && k.timelineKey) || [];
    if (!want.length) return { pts: 0, max: 0, matched: 0 };
    var rows = picks.map(function (p) { return rowText(lv, p); });
    var idx = 0, matched = 0;
    for (var i = 0; i < want.length; i++) {
      for (var r = idx; r < rows.length; r++) {
        if (rows[r] && rows[r].indexOf(want[i]) !== -1) { matched++; idx = r + 1; break; }
      }
    }
    return { pts: (matched / want.length) * 2, max: 2, matched: matched, total: want.length };
  }
  function rowText(lv, pick) {
    var p = String(pick).split(":");
    var set = lv.evidence[+p[0]];
    return set ? set.rows[+p[1]] : "";
  }

  function grade(lv) {
    var w = work(lv.id), k = keyFor(lv.id) || {};
    var kq = {}; (k.questions || []).forEach(function (q) { kq[q.id] = q; });
    var items = [], pts = 0, max = 0;

    lv.questions.forEach(function (q, i) {
      var key = kq[q.id] || {};
      var merged = { type: q.type, accept: key.accept || [] };
      var raw = w.answers[q.id] || "";
      var s = matchQuestion(merged, raw);
      pts += s; max += 1;
      items.push({
        mark: s === 1 ? "good" : (s > 0 ? "part" : "bad"),
        label: (i + 1) + ". " + q.label,
        given: raw || "(no answer)",
        note: s === 1 ? "Correct." : (s > 0 ? "Partially correct - close, but not precise enough for a report."
          : "Incorrect or not supported by the evidence.")
      });
    });

    /* decision - weighted, it is the analyst's core output */
    max += 2;
    var dOK = k.decision && w.decision === k.decision;
    if (dOK) pts += 2;
    items.push({
      mark: dOK ? "good" : "bad",
      label: "Investigation decision",
      given: labelDecision(w.decision) || "(none)",
      note: dOK ? "Correct classification." : "Incorrect classification - re-read the evidence in the review below."
    });

    /* severity - one step out scores half */
    max += 1;
    var gi = SEVERITIES.indexOf(String(w.severity || "").toUpperCase());
    var wi = SEVERITIES.indexOf(String(k.severity || "").toUpperCase());
    var sv = 0;
    if (gi >= 0 && wi >= 0) sv = gi === wi ? 1 : (Math.abs(gi - wi) === 1 ? 0.5 : 0);
    pts += sv;
    items.push({
      mark: sv === 1 ? "good" : (sv > 0 ? "part" : "bad"),
      label: "Severity assessment",
      given: w.severity || "(none)",
      note: sv === 1 ? "Matches the assessed severity." :
        (sv > 0 ? "One band out - defensible, but justify it in the report." :
          "Severity does not match the impact shown in the evidence.")
    });

    /* recommendation */
    max += 1;
    var rec = norm(w.recommend), any = ((k.recommend || {}).any || []).map(norm);
    var rHit = any.some(function (t) { return t && rec.indexOf(t) !== -1; });
    var rs = rec.length >= 40 && rHit ? 1 : (rHit || rec.length >= 40 ? 0.5 : 0);
    pts += rs;
    items.push({
      mark: rs === 1 ? "good" : (rs > 0 ? "part" : "bad"),
      label: "Recommended action",
      given: w.recommend || "(none)",
      note: rs === 1 ? "Actionable and correct." :
        (rs > 0 ? "On the right lines but incomplete - say what, on which asset, and who owns it." :
          "Not an actionable recommendation for this case.")
    });

    /* timeline */
    var tl = timelineScore(lv, w.picks || []);
    if (tl.max) {
      pts += tl.pts; max += tl.max;
      items.push({
        mark: tl.matched === tl.total ? "good" : (tl.matched ? "part" : "bad"),
        label: "Attack timeline",
        given: tl.matched + " of " + tl.total + " key events selected in order",
        note: tl.matched === tl.total ? "Timeline reconstructed correctly." :
          "Select the decisive evidence rows, in chronological order, in the evidence panel."
      });
    }

    /* master report sections */
    if (lv.report && lv.report.length) {
      lv.report.forEach(function (sec) {
        max += 1;
        var txt = (w.report && w.report[sec.id]) || "";
        var len = txt.trim().length;
        var s = len >= sec.min ? 1 : (len >= Math.round(sec.min * 0.5) ? 0.5 : 0);
        pts += s;
        items.push({
          mark: s === 1 ? "good" : (s > 0 ? "part" : "bad"),
          label: "Report - " + sec.label,
          given: len ? len + " characters" : "(empty)",
          note: s === 1 ? "Section complete." :
            (s > 0 ? "Too thin for an incident report. Guide: " + sec.guide :
              "Section missing. Guide: " + sec.guide)
        });
      });
    }

    var pct = max ? Math.round((pts / max) * 100) : 0;
    return { pct: pct, pts: pts, max: max, items: items, review: k.review || "" };
  }
  function labelDecision(v) {
    for (var i = 0; i < DECISIONS.length; i++) if (DECISIONS[i][0] === v) return DECISIONS[i][1];
    return "";
  }

  /* ============================ routing ============================ */
  var view = { stage: {}, quizResult: {} };   // per-level stage: theory | quiz | guided | work | review
  function route() {
    var h = (location.hash || "#/").replace(/^#/, "");
    var parts = h.split("/").filter(Boolean);
    return { page: parts[0] || "dashboard", arg: parts[1] };
  }
  function go(hash) { location.hash = hash; }
  window.addEventListener("hashchange", render);

  /* ============================ views ============================ */
  function render() {
    var r = route();
    var main = $("#main");
    var html = "";
    try {
      switch (r.page) {
        case "levels": html = viewLevels(); break;
        case "level": html = viewLevel(+r.arg); break;
        case "book": html = r.arg ? viewChapter(+r.arg) : viewBook(); break;
        case "tools": html = viewTools(); break;
        case "progress": html = viewProgress(); break;
        case "admin": html = viewAdmin(); break;
        default: html = viewDashboard();
      }
    } catch (e) {
      console.error("[soc] render failed", e);
      html = '<div class="card"><h2>Something went wrong rendering this page</h2>' +
        '<p class="muted">' + esc(e.message) + '</p>' +
        '<button class="btn-primary" onclick="location.hash=\'#/\'">Back to dashboard</button></div>';
    }
    main.innerHTML = html;
    $$("#nav button").forEach(function (b) {
      if (b.dataset.page === r.page) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
      if (b.dataset.page === "book") b.hidden = sectionDisabled("book");
    });
    var aboutLink = $("#navAbout");
    if (aboutLink) aboutLink.hidden = sectionDisabled("about");
    document.body.setAttribute("data-ai-assistant", sectionDisabled("ai") ? "off" : "on");
    var aiFab = $(".ai-fab"), aiPanel = $(".ai-panel");
    if (aiFab) aiFab.style.display = sectionDisabled("ai") ? "none" : "";
    if (aiPanel) aiPanel.style.display = sectionDisabled("ai") ? "none" : "";
    $("#status").textContent = doneCount() + "/30 complete  -  hints " + hintsLeft() + "/" + HINT_MAX;
    afterRender(r);
    window.scrollTo(0, 0);
  }

  /* ---------------- dashboard ---------------- */
  function viewDashboard() {
    var done = doneCount(), cur = currentLevel(), lv = levelById(cur);
    var scores = Object.keys(state.completed).map(function (k) { return state.completed[k].pct; });
    var avg = scores.length ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length) : 0;
    return '' +
      '<div class="card">' +
      '<div class="spread"><div><h1>Northwind Logistics - Security Operations Centre</h1>' +
      '<p class="muted small">Analyst training environment. All hosts, users, addresses and incidents are fictional.</p></div>' +
      '<div><button class="btn-primary" onclick="location.hash=\'#/level/' + cur + '\'">' +
      (done ? "Continue Level " + cur : "Start Level 1") + '</button></div></div>' +
      '<div class="bar" style="margin-top:.8rem"><i style="width:' + (done / 30 * 100) + '%"></i></div>' +
      '<p class="small muted" style="margin-top:.35rem">' + done + ' of 30 investigations closed</p>' +
      '</div>' +

      '<div class="grid cols-4">' +
      kpi(done + "/30", "Levels completed") +
      kpi(avg + "%", "Average score") +
      kpi(hintsLeft() + "/" + HINT_MAX, "Hints available (24h)") +
      kpi(bookUnlocked() ? "UNLOCKED" : "LOCKED", "Zero-to-Hero book") +
      '</div>' +

      '<div class="card"><h2>Current assignment</h2>' +
      (lv ? '<p><strong>Level ' + pad(lv.id) + ' - ' + esc(lv.title) + '</strong> ' +
        '<span class="tag">' + esc(lv.tier) + '</span> <span class="tag">' + esc(lv.domain) + '</span></p>' +
        '<p class="small">' + esc(lv.case.brief.slice(0, 260)) + (lv.case.brief.length > 260 ? "..." : "") + '</p>' +
        '<button onclick="location.hash=\'#/level/' + lv.id + '\'">Open case ' + esc(lv.case.id) + '</button>'
        : '<p>All investigations closed.</p>') +
      '</div>' +

      '<div class="grid cols-3">' +
      '<div class="card"><h3>Investigation workflow</h3><p class="small muted">Read the briefing, work the evidence, build a timeline, then commit to a decision, a severity and a recommendation. Nothing is graded until you submit.</p></div>' +
      '<div class="card"><h3>Hint policy</h3><p class="small muted">Two hints per rolling 24 hours across the whole platform. Hints direct you to the right evidence; they never contain the answer. ' + esc(hintCountdown()) + '</p></div>' +
      '<div class="card"><h3>Command reference</h3><p class="small muted">Press CTRL + SHIFT + C then D, or use the button at the bottom right, for the Linux, Windows, network and investigation command reference. Reference only - nothing is executed.</p></div>' +
      '</div>';
  }
  function kpi(v, l) { return '<div class="kpi"><div class="v">' + esc(v) + '</div><div class="l">' + esc(l) + '</div></div>'; }

  /* ---------------- level list ---------------- */
  function viewLevels() {
    var out = '<div class="card"><div class="spread"><h1>Investigation path</h1>' +
      '<span class="small muted">Levels unlock strictly in sequence.</span></div></div><div class="levels">';
    LEVELS.forEach(function (lv) {
      var done = isDone(lv.id), open = isUnlocked(lv.id) && !done, cls = done ? "done" : (open ? "open" : "locked");
      if (lv.master) cls += " master";
      var rec = state.completed[String(lv.id)];
      out += '<button class="lvl ' + cls + '" data-open="' + lv.id + '"' + (isUnlocked(lv.id) ? "" : ' aria-disabled="true"') + '>' +
        '<span class="n">LEVEL ' + pad(lv.id) + (lv.master ? " - MASTER" : "") + '</span>' +
        '<span class="t">' + esc(isUnlocked(lv.id) ? lv.title : lv.title) + '</span>' +
        '<span class="small muted">' + esc(lv.domain) + '</span><br>' +
        (done ? '<span class="tag">CLOSED ' + rec.pct + '%</span>'
          : open ? '<span class="tag">AVAILABLE</span>'
            : adminLevelDisabled(lv.id) ? '<span class="tag">DISABLED BY ADMIN</span>'
              : '<span class="tag">LOCKED - needs level ' + pad(lv.id - 1) + '</span>') +
        '</button>';
    });
    return out + '</div>';
  }

  /* ---------------- level ---------------- */
  function viewLevel(id) {
    var lv = levelById(id);
    if (!lv) return '<div class="card"><h2>Unknown level</h2></div>';
    if (!isUnlocked(id)) {
      if (adminLevelDisabled(id)) {
        return '<div class="card"><div class="locked-notice">' +
          '<div class="big">LEVEL ' + pad(id) + '</div>' +
          '<div class="lk">TEMPORARILY DISABLED</div>' +
          '<p>This level has been temporarily disabled by an administrator. Its content is preserved and can be re-enabled at any time.</p>' +
          '<button class="btn-primary" onclick="location.hash=\'#/\'">Back to dashboard</button>' +
          '</div></div>';
      }
      return '<div class="card"><div class="locked-notice">' +
        '<div class="big">LEVEL ' + pad(id) + '</div>' +
        '<div class="lk">LOCKED</div>' +
        '<p>Requirement: Complete Level ' + pad(id - 1) + '</p>' +
        '<button class="btn-primary" onclick="location.hash=\'#/level/' + (id - 1) + '\'">Go to Level ' + pad(id - 1) + '</button>' +
        '</div></div>';
    }
    /* full training-flow stage gate: theory -> quiz -> guided -> work (real investigation) -> review */
    var st = view.stage[id] || (isDone(id) ? "review" : "theory");
    var tDone = theoryDone(lv), qPassed = quizPassed(lv), gDone = guidedDone(lv);
    if (st === "quiz" && !tDone) st = "theory";
    if (st === "guided" && !qPassed) st = tDone ? "quiz" : "theory";
    if (st === "work" && !gDone) st = qPassed ? "guided" : (tDone ? "quiz" : "theory");
    view.stage[id] = st;
    if (st === "theory") return viewTheory(lv);
    if (st === "quiz") return viewQuiz(lv);
    if (st === "guided") return viewGuided(lv);
    if (st === "review") return viewReview(lv);
    return viewWorkspace(lv);
  }

  function stageNav(lv, gates) {
    return '<div class="card"><div class="stageflow small muted">' +
      '<span class="stagechip done">1. THEORY</span>' +
      '<span class="stagechip ' + (gates.tDone ? "done" : "locked") + '">2. KNOWLEDGE TEST ' + (gates.tDone ? "" : "&#128274;") + '</span>' +
      '<span class="stagechip ' + (gates.qPassed ? "done" : "locked") + '">3. GUIDED INVESTIGATION ' + (gates.qPassed ? "" : "&#128274;") + '</span>' +
      '<span class="stagechip ' + (gates.gDone ? "done" : "locked") + '">4. REAL INVESTIGATION ' + (gates.gDone ? "" : "&#128274;") + '</span>' +
      '<span class="stagechip">5. ASSESSMENT</span>' +
      '</div></div>';
  }

  /* ---------------- theory (chapters) ---------------- */
  function viewTheory(lv) {
    var ch = chaptersFor(lv), ts = theoryState(lv.id);
    var readCount = ch.filter(function (c) { return ts.read.indexOf(c.id) !== -1; }).length;
    var pct = ch.length ? Math.round((readCount / ch.length) * 100) : 0;
    var gates = { tDone: theoryDone(lv), qPassed: quizPassed(lv), gDone: guidedDone(lv) };

    var out = stageNav(lv, gates);
    out += '<div class="card"><span class="small muted">PHASE 1 - DEEP THEORY</span>' +
      '<h1>Level ' + pad(lv.id) + ' - ' + esc(lv.title) + '</h1>' +
      '<p class="small"><span class="tag">' + esc(lv.tier) + '</span> <span class="tag">' + esc(lv.domain) + '</span> ' +
      '<span class="tag">MITRE: ' + esc(lv.mitre) + '</span></p>' +
      '<p class="small muted" style="margin:.4rem 0">Theory Progress</p>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<p class="small muted" style="margin-top:.3rem">' + readCount + ' / ' + ch.length + ' chapters read (' + pct + '%). ' +
      (gates.tDone ? '&#9989; Theory Completed - Knowledge Test unlocked below.' : 'Sab chapters "Mark as Learned" karo taake Knowledge Test unlock ho.') + '</p></div>';

    ch.forEach(function (c, i) {
      var isRead = ts.read.indexOf(c.id) !== -1;
      out += '<div class="card chapter-card' + (isRead ? " read" : "") + '"><div class="spread"><h2 style="margin:0">' + esc(c.title) + '</h2>' +
        (isRead ? '<span class="tag good">READ</span>' : '<span class="tag">' + (i + 1) + ' / ' + ch.length + '</span>') + '</div>';
      if (c.body) out += '<p>' + esc(c.body) + '</p>';
      if (c.example) out += '<p class="small"><strong>Misal (Example):</strong> ' + esc(c.example) + '</p>';
      if (c.lookFor) out += '<p class="small"><strong>SOC Analyst ko kya dekhna chahiye:</strong> ' + esc(c.lookFor) + '</p>';
      if (c.mistake) out += '<p class="small"><strong>Common mistake:</strong> ' + esc(c.mistake) + '</p>';
      if (c.practical) out += '<p class="small"><strong>Practical:</strong> ' + esc(c.practical) + '</p>';
      out += '<div class="row" style="margin-top:.6rem">' +
        (isRead ? '<span class="small muted">&#10003; Marked as learned</span>' : '<button class="btn-sm" data-readchapter="' + esc(c.id) + '" data-level="' + lv.id + '">Mark as Learned / Continue</button>') +
        '</div></div>';
    });

    out += '<div class="card"><div class="spread"><p class="muted small" style="margin:0">' +
      (gates.tDone ? 'Theory mukammal ho gayi. Ab Knowledge Test do - pass hone ke liye 10/10 (100%) chahiye.' :
        '&#128274; Knowledge Test Locked - sab chapters mukammal karo.') + '</p>' +
      '<button class="btn-primary"' + (gates.tDone ? "" : " disabled") + ' data-stage="quiz" data-level="' + lv.id + '">Go to Knowledge Test</button></div></div>';
    return out;
  }

  /* ---------------- knowledge test (10-question MCQ, 100% to pass) ---------------- */
  function viewQuiz(lv) {
    var gates = { tDone: theoryDone(lv), qPassed: quizPassed(lv), gDone: guidedDone(lv) };
    if (!gates.tDone) {
      return stageNav(lv, gates) + '<div class="card"><div class="locked-notice"><div class="lk">&#128274; KNOWLEDGE TEST LOCKED</div>' +
        '<p>Complete the theory chapters before attempting this test.</p>' +
        '<button class="btn-primary" data-stage="theory" data-level="' + lv.id + '">Back to Theory</button></div></div>';
    }
    var qs = quizStateOf(lv.id);
    var out = stageNav(lv, gates);

    if (view.quizResult && view.quizResult[lv.id]) {
      var res = view.quizResult[lv.id];
      var passed = res.pct === 100;
      out += '<div class="card"><h1>' + (passed ? "Knowledge Test Passed" : "Test Failed") + '</h1>' +
        '<div class="score" style="color:' + (passed ? "var(--ok)" : "var(--bad)") + '">' + res.correctCount + ' / ' + res.total + '</div>' +
        (passed ? '<div class="notice ok" style="margin-top:.6rem">&#9989; Knowledge Test Passed &nbsp; &#128275; Guided Investigation Unlocked</div>' :
          '<div class="notice bad" style="margin-top:.6rem">Is investigation ko unlock karne ke liye 100% score required hai. Neeche apni mistakes review karo.</div>') +
        '</div>';
      out += '<div class="card"><h2>Review</h2>' + res.results.map(function (r, i) {
        return '<div class="rev ' + (r.ok ? "good" : "bad") + '"><span class="m">' + (r.ok ? "&#10003;" : "&#10007;") + '</span><span>' +
          '<strong>' + (i + 1) + '. ' + esc(r.q) + '</strong><br>' +
          '<span class="small muted">Your answer: ' + esc(r.given !== undefined ? r.options[r.given] : "(no answer)") + '</span><br>' +
          '<span class="small muted">Correct answer: ' + esc(r.options[r.correctPos]) + '</span><br>' +
          '<span class="small">' + esc(r.explain) + '</span></span></div>';
      }).join("") + '</div>';
      out += '<div class="card"><div class="row">' +
        (passed ? '<button class="btn-primary" data-stage="guided" data-level="' + lv.id + '">Continue to Guided Investigation</button>' :
          '<button class="btn-primary" data-quizretry="' + lv.id + '">Retry Test (new random questions)</button>' +
          '<button class="btn-ghost" data-stage="theory" data-level="' + lv.id + '">Review Theory</button>') +
        '</div></div>';
      return out;
    }

    var set = currentQuizSet(lv);
    var answeredCount = Object.keys(qs.answers || {}).length;
    out += '<div class="card"><h1>Knowledge Test</h1>' +
      '<p class="small muted">' + set.length + ' random questions from the topic bank. Exactly 100% (all correct) required to unlock the Guided Investigation. ' +
      (qs.attempts ? "Attempts so far: " + qs.attempts + ", best score: " + qs.bestPct + "%." : "") + '</p>' +
      '<div class="bar"><i style="width:' + Math.round((answeredCount / set.length) * 100) + '%"></i></div>' +
      '<p class="small muted" style="margin-top:.3rem">' + answeredCount + ' / ' + set.length + ' answered</p></div>';

    out += '<div class="card"><div class="body" style="padding:0">';
    set.forEach(function (item, i) {
      out += '<div class="q"><div class="qh"><span class="qn">' + pad(i + 1) + '</span><label style="flex:1">' + esc(item.q) + '</label></div>';
      item.options.forEach(function (opt, oi) {
        var checked = qs.answers[item.id] === oi;
        out += '<label class="mcq-opt' + (checked ? " picked" : "") + '"><input type="radio" name="quiz_' + esc(item.id) + '" value="' + oi + '" data-quizq="' + esc(item.id) + '" data-level="' + lv.id + '"' + (checked ? " checked" : "") + '> ' + esc(opt) + '</label>';
      });
      out += '</div>';
    });
    out += '</div></div>';

    out += '<div class="card"><button class="btn-primary" data-quizsubmit="' + lv.id + '">Submit Test</button> ' +
      '<button class="btn-ghost" data-stage="theory" data-level="' + lv.id + '">Back to Theory</button></div>';
    return out;
  }

  /* ---------------- guided investigation ---------------- */
  function viewGuided(lv) {
    var gates = { tDone: theoryDone(lv), qPassed: quizPassed(lv), gDone: guidedDone(lv) };
    if (!gates.qPassed) {
      return stageNav(lv, gates) + '<div class="card"><div class="locked-notice"><div class="lk">&#128274; GUIDED INVESTIGATION LOCKED</div>' +
        '<p>Pass the Knowledge Test with 100% first.</p>' +
        '<button class="btn-primary" data-stage="quiz" data-level="' + lv.id + '">Go to Knowledge Test</button></div></div>';
    }
    var g = guidedFor(lv), gs = guidedStateOf(lv.id);
    var stepIdx = Math.min(gs.step || 0, g.steps.length - 1);
    var step = g.steps[stepIdx];
    var out = stageNav(lv, gates);

    out += '<div class="card"><h1>' + esc(g.title) + '</h1><p class="small muted">' + esc(g.brief) + '</p>' +
      '<div class="bar"><i style="width:' + Math.round(((stepIdx) / g.steps.length) * 100) + '%"></i></div>' +
      '<p class="small muted" style="margin-top:.3rem">Current Step: ' + (stepIdx + 1) + ' / ' + g.steps.length + '</p></div>';

    if (g.evidence && g.evidence.length) {
      out += '<div class="panel"><header><span>GUIDED EVIDENCE</span></header><div class="body">';
      g.evidence.forEach(function (set) {
        out += '<div class="evidence-set"><header><span>' + esc(set.name) + '</span></header><div class="rows">' +
          set.rows.map(function (r, ri) { return '<div class="logrow"><span class="idx">' + pad(ri + 1) + '</span><span>' + esc(r) + '</span></div>'; }).join("") +
          '</div></div>';
      });
      out += '</div></div>';
    }

    var seen = gs.seen.indexOf(step.id) !== -1;
    out += '<div class="card"><h2>' + esc(step.title) + '</h2><p>' + esc(step.ask) + '</p>' +
      '<p class="small muted"><strong>Kyun zaroori hai:</strong> ' + esc(step.why || "") + '</p>';

    if (step.type === "search") {
      out += '<div class="row"><input type="text" id="guidedSearch" placeholder="' + esc(step.hintText || "Search evidence...") + '" style="flex:1;min-width:200px">' +
        '<button class="btn-primary" data-guidedsearch="' + lv.id + '">Search Evidence</button></div>';
    } else if (step.type === "choice") {
      out += '<div>' + step.options.map(function (o, oi) {
        return '<label class="mcq-opt"><input type="radio" name="guidedchoice" value="' + oi + '" data-guidedchoice="' + lv.id + '"> ' + esc(o) + '</label>';
      }).join("") + '</div><button class="btn-primary" data-guidedchoicesubmit="' + lv.id + '" style="margin-top:.5rem">Submit</button>';
    } else {
      out += '<button class="btn-primary" data-guidedreveal="' + lv.id + '">' + esc(step.buttonLabel || "Show Me") + '</button>';
    }

    if (seen) {
      out += '<div class="notice ok" style="margin-top:.8rem">' + esc(step.reveal || step.explain || "") + '</div>' +
        '<div class="row" style="margin-top:.6rem">' +
        (stepIdx + 1 < g.steps.length
          ? '<button class="btn-primary" data-guidednext="' + lv.id + '">Next Step</button>'
          : '<button class="btn-primary" data-guidedfinish="' + lv.id + '">Finish Guided Investigation</button>') +
        '</div>';
    }
    out += '</div>';
    return out;
  }

  function viewWorkspace(lv) {
    var w = work(lv.id);
    if (!w.startedAt) { w.startedAt = Date.now(); save(); }
    var c = lv.case;
    var out = '<div class="case-head">' +
      '<div class="spread"><h1 style="margin:0">' + esc(c.alert) + '</h1>' +
      '<span class="tag sev sev-' + norm(c.severity) + '">' + esc(c.severity) + '</span></div>' +
      '<dl>' +
      '<dt>CASE ID</dt><dd>' + esc(c.id) + '</dd>' +
      '<dt>SEVERITY</dt><dd>' + esc(c.severity) + '</dd>' +
      '<dt>HOST</dt><dd>' + esc(c.host) + '</dd>' +
      '<dt>TIME</dt><dd>' + esc(c.time) + '</dd>' +
      '<dt>SOURCE</dt><dd>' + esc(c.source) + '</dd>' +
      '<dt>MITRE</dt><dd>' + esc(lv.mitre) + '</dd>' +
      '</dl><p style="margin-top:.7rem">' + esc(c.brief) + '</p>' +
      (lv.tierNote ? '<p class="small muted">' + esc(lv.tierNote) + '</p>' : '') +
      '</div>';

    out += '<div class="ws"><div>';

    /* evidence + search */
    out += '<div class="panel"><header><span>EVIDENCE</span>' +
      '<span class="small muted" id="pickcount">' + (w.picks.length) + ' rows on timeline</span></header><div class="body">' +
      '<div class="row" style="margin-bottom:.6rem">' +
      '<input type="text" id="search" placeholder="Search all evidence (account, address, event id, process)" style="flex:1;min-width:200px" value="">' +
      '<button class="btn-sm" id="clearsearch">Clear</button>' +
      '<button class="btn-sm" id="clearpicks">Clear timeline</button>' +
      '</div><div id="evidence">' + evidenceHTML(lv, "") + '</div></div></div>';

    /* terminal */
    out += '<div class="panel"><header><span>ANALYST TERMINAL (SIMULATED)</span>' +
      '<span class="small muted">type help</span></header><div class="body">' +
      '<div class="term" id="term">Northwind SOC analysis jump box - simulated shell.\nEvidence from this case is mounted read-only. Type "help" for commands.\n</div>' +
      '<div class="term-input"><span>analyst@soc:~$</span><input type="text" id="termin" aria-label="terminal input" autocomplete="off"></div>' +
      '</div></div>';

    out += '</div><div>';

    /* questions */
    out += '<div class="panel"><header><span>INVESTIGATION TASK</span><span class="small muted">' + lv.questions.length + ' questions</span></header><div class="body">';
    lv.questions.forEach(function (q, i) {
      var tok = lv.id + ":" + q.id, shown = hintRevealed(tok);
      var key = ((keyFor(lv.id) || {}).questions || []).filter(function (x) { return x.id === q.id; })[0] || {};
      out += '<div class="q"><div class="qh"><span class="qn">' + pad(i + 1) + '</span><label for="a_' + q.id + '" style="flex:1">' + esc(q.label) + '</label></div>';
      if (q.type === "choice") {
        out += '<select id="a_' + q.id + '" data-q="' + q.id + '" class="ans"><option value="">-- select --</option>' +
          q.options.map(function (o) {
            return '<option value="' + esc(o) + '"' + (norm(w.answers[q.id]) === norm(o) ? " selected" : "") + '>' + esc(o) + '</option>';
          }).join("") + '</select>';
      } else {
        out += '<input type="text" id="a_' + q.id + '" data-q="' + q.id + '" class="ans" value="' + esc(w.answers[q.id] || "") + '"' +
          (q.placeholder ? ' placeholder="' + esc(q.placeholder) + '"' : '') + '>';
      }
      out += '<div class="row small" style="margin-top:.3rem"><button class="btn-sm" data-hint="' + tok + '">' +
        (shown ? "Hint shown" : "Use a hint") + '</button>' +
        '<span class="muted">' + (shown ? "" : hintsLeft() + " left in this 24h window") + '</span></div>';
      if (shown) out += '<div class="hintbox">' + esc(key.hint || "No hint recorded for this question.") + '</div>';
      out += '</div>';
    });
    out += '</div></div>';

    /* notes */
    out += '<div class="panel"><header><span>ANALYST NOTES</span></header><div class="body">' +
      '<textarea id="notes" placeholder="Working notes - saved automatically and kept after you close the browser.">' + esc(w.notes) + '</textarea></div></div>';

    /* timeline */
    out += '<div class="panel"><header><span>TIMELINE</span></header><div class="body">' +
      '<p class="small muted">Tick evidence rows in chronological order to build the attack timeline.</p>' +
      '<div id="timeline">' + timelineHTML(lv) + '</div></div></div>';

    /* master report */
    if (lv.report && lv.report.length) {
      out += '<div class="panel"><header><span>MASTER SOC REPORT</span><span class="small muted">' + lv.report.length + ' sections</span></header><div class="body">';
      lv.report.forEach(function (sec) {
        var val = (w.report && w.report[sec.id]) || "";
        out += '<fieldset><legend>' + esc(sec.label) + '</legend>' +
          '<p class="small muted" style="margin:0 0 .35rem">' + esc(sec.guide) + ' (minimum ' + sec.min + ' characters)</p>' +
          '<textarea class="rep" data-sec="' + esc(sec.id) + '">' + esc(val) + '</textarea>' +
          '<div class="small muted" data-count="' + esc(sec.id) + '">' + val.trim().length + ' / ' + sec.min + '</div></fieldset>';
      });
      out += '</div></div>';
    }

    /* findings / decision */
    out += '<div class="panel"><header><span>FINDINGS AND DECISION</span></header><div class="body">' +
      '<label for="decision">Investigation decision</label><select id="decision">' +
      '<option value="">-- select --</option>' +
      DECISIONS.map(function (d) { return '<option value="' + d[0] + '"' + (w.decision === d[0] ? " selected" : "") + '>' + d[1] + '</option>'; }).join("") +
      '</select>' +
      '<label for="severity" style="margin-top:.6rem">Severity assessment</label><select id="severity">' +
      '<option value="">-- select --</option>' +
      SEVERITIES.map(function (s) { return '<option value="' + s + '"' + (w.severity === s ? " selected" : "") + '>' + s + '</option>'; }).join("") +
      '</select>' +
      '<label for="recommend" style="margin-top:.6rem">Recommended action</label>' +
      '<textarea id="recommend" placeholder="What should be done, on which asset, by whom, and in what order.">' + esc(w.recommend) + '</textarea>' +
      '<div class="row" style="margin-top:.8rem"><button class="btn-primary" id="submit">Submit investigation</button>' +
      '<button class="btn-ghost" data-stage="theory" data-level="' + lv.id + '">Back to Theory</button></div>' +
      '<p class="small muted" style="margin-top:.5rem">Pass mark ' + PASS + '%. Level ' + pad(lv.id + 1) + ' unlocks only on a pass.</p>' +
      '</div></div>';

    out += '</div></div>';
    return out;
  }

  function evidenceHTML(lv, q) {
    var w = work(lv.id), term = norm(q), out = "";
    lv.evidence.forEach(function (set, si) {
      var rows = set.rows.map(function (r, ri) { return { r: r, ri: ri }; });
      if (term) rows = rows.filter(function (x) { return norm(x.r).indexOf(term) !== -1; });
      if (term && !rows.length) return;
      out += '<div class="evidence-set"><header><span>' + esc(set.name) + '</span>' +
        '<span class="small muted">' + rows.length + (term ? " matching" : "") + ' rows</span></header><div class="rows">';
      rows.forEach(function (x) {
        var pick = si + ":" + x.ri, on = w.picks.indexOf(pick) !== -1;
        out += '<div class="logrow' + (on ? " picked" : "") + '">' +
          '<input class="pick" type="checkbox" data-pick="' + pick + '"' + (on ? " checked" : "") +
          ' aria-label="add row ' + (x.ri + 1) + ' to timeline">' +
          '<span class="idx">' + pad(x.ri + 1) + '</span><span>' + highlight(x.r, term) + '</span></div>';
      });
      out += '</div></div>';
    });
    return out || '<p class="muted small">No evidence rows match that search.</p>';
  }
  function highlight(text, term) {
    var h = esc(text);
    if (!term) return h;
    try {
      var re = new RegExp("(" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
      return h.replace(re, "<mark>$1</mark>");
    } catch (e) { return h; }
  }
  function timelineHTML(lv) {
    var w = work(lv.id);
    if (!w.picks.length) return '<p class="small muted">No rows selected yet.</p>';
    return '<ol class="small" style="margin:0;padding-left:1.2rem">' + w.picks.map(function (p) {
      return '<li style="font-family:var(--mono);font-size:.78rem;margin-bottom:.2rem">' + esc(rowText(lv, p).slice(0, 190)) + '</li>';
    }).join("") + '</ol>';
  }

  /* ---------------- review ---------------- */
  function viewReview(lv) {
    var rec = state.completed[String(lv.id)];
    var g = rec && rec.grade ? rec.grade
      : (rec ? { pct: rec.pct, items: [], review: (keyFor(lv.id) || {}).review || "" } : grade(lv));
    var passed = g.pct >= PASS;
    var w = work(lv.id);
    var secs = Math.round(((rec && rec.seconds) || ((Date.now() - (w.startedAt || Date.now())) / 1000)));
    var mistakes = g.items.filter(function (i) { return i.mark !== "good"; }).length;

    var out = '<div class="card"><div class="spread">' +
      '<div><h1 style="margin:0">' + (passed ? "INVESTIGATION COMPLETED" : "INVESTIGATION NOT ACCEPTED") + '</h1>' +
      '<p class="muted small" style="margin:0">Level ' + pad(lv.id) + ' - ' + esc(lv.title) + ' - case ' + esc(lv.case.id) + '</p></div>' +
      '<div style="text-align:right"><div class="score" style="color:' + (passed ? "var(--ok)" : "var(--bad)") + '">' + g.pct + '%</div>' +
      '<div class="small muted">pass mark ' + PASS + '%</div></div></div>' +
      (passed ? '' : '<div class="notice bad" style="margin-top:.8rem">Below the pass mark. Read the analyst review, correct your findings and submit again. Level ' + pad(lv.id + 1) + ' stays locked until this case is closed correctly.</div>') +
      '</div>';

    out += '<div class="grid cols-4">' +
      kpi(hhmm(secs * 1000), "Time on case") +
      kpi(mistakes, "Findings to correct") +
      kpi(labelDecision(w.decision) || "-", "Your decision") +
      kpi(w.severity || "-", "Your severity") +
      '</div>';

    out += '<div class="card"><h2>Scored feedback</h2>' + g.items.map(function (i) {
      var m = i.mark === "good" ? "&#10003;" : (i.mark === "part" ? "&#9888;" : "&#10007;");
      return '<div class="rev ' + i.mark + '"><span class="m">' + m + '</span><span>' +
        '<strong>' + esc(i.label) + '</strong><br><span class="small muted">You entered: ' + esc(String(i.given).slice(0, 220)) + '</span><br>' +
        '<span class="small">' + esc(i.note) + '</span></span></div>';
    }).join("") + '</div>';

    out += '<div class="card"><h2>Analyst review</h2><p>' + esc(g.review) + '</p>' +
      '<p class="small muted">Evidence quality: ' + (w.picks.length ? w.picks.length + ' rows cited on the timeline' : 'no evidence cited - a report without cited evidence is not defensible') + '.</p></div>';

    if (g.items && g.items.length) {
      var sb = skillBreakdown(g);
      out += '<div class="card"><h2>Skills</h2>' + SKILLS.map(function (s) {
        var v = sb[s];
        return v === null ? "" : '<div class="row" style="align-items:center;margin-bottom:.3rem"><span class="small" style="min-width:150px">' + s + '</span>' +
          '<div class="bar" style="flex:1"><i style="width:' + v + '%"></i></div><span class="small muted" style="min-width:40px;text-align:right">' + v + '%</span></div>';
      }).join("") + '</div>';
    }

    if (passed) {
      out += '<div class="card"><h2>Next task</h2><p>' + esc(lv.next) + '</p>' +
        (lv.id < 30 ? '<button class="btn-primary" onclick="location.hash=\'#/level/' + (lv.id + 1) + '\'">Start next investigation</button>'
          : '<div class="notice ok"><strong>MASTER SOC ANALYST.</strong> All 30 investigations closed, including the master multi-stage assessment and its full incident report. The Zero-to-Hero SOC Analyst book is now unlocked.</div>' +
          '<div class="notice ok" style="text-align:center;margin-top:.6rem"><div style="font-family:var(--mono);letter-spacing:.14em;font-weight:700">30 / 30 LEVELS COMPLETE</div><strong>SOC Analyst Training Completed.</strong> Your Zero-to-Hero SOC Analyst Book is now unlocked.</div>' + guideButtons(true) +
          '<button class="btn-primary" onclick="location.hash=\'#/book\'">Open the book page</button>') +
        ' <button class="btn-ghost" data-stage="work" data-level="' + lv.id + '">Reopen this case</button>' +
        '</div>';
    } else {
      out += '<div class="card"><h2>Case Not Passed</h2><p class="small muted">Review the concepts above, then retry.</p><div class="row">' +
        '<button class="btn-ghost" data-stage="theory" data-level="' + lv.id + '">Review Theory</button>' +
        '<button class="btn-ghost" data-stage="guided" data-level="' + lv.id + '">Repeat Guided Investigation</button>' +
        '<button class="btn-primary" data-stage="work" data-level="' + lv.id + '">Retry Real Investigation</button>' +
        '</div></div>';
    }
    return out;
  }

  /* ---------------- tools ---------------- */
  function viewTools() {
    var done = doneCount();
    var rows = "";
    for (var i = 1; i <= 30; i++) {
      var r = state.completed[String(i)], lv = levelById(i);
      rows += '<tr><td>' + pad(i) + '</td><td>' + esc(lv.title) + '</td><td>' + esc(lv.case.id) + '</td>' +
        '<td>' + (r ? labelDecision(r.decision) : "-") + '</td><td>' + (r ? r.severity : "-") + '</td>' +
        '<td>' + (r ? r.pct + "%" : (isUnlocked(i) ? "open" : "locked")) + '</td></tr>';
    }
    return '<div class="card"><h1>Case management</h1>' +
      '<p class="muted small">Every investigation you have submitted, with its recorded decision and severity. This is the record a SOC would keep.</p>' +
      '<div style="overflow:auto"><table class="data"><thead><tr><th>Level</th><th>Title</th><th>Case</th><th>Decision</th><th>Severity</th><th>Result</th></tr></thead><tbody>' +
      rows + '</tbody></table></div></div>' +
      '<div class="card"><h2>Command reference</h2><p class="small muted">Press CTRL + SHIFT + C then D at any time, or use the button below. Reference material only - no command is executed against your machine.</p>' +
      '<button class="btn-primary" id="openpal">Open command reference</button></div>' +
      '<div class="card"><h2>Progress data</h2><p class="small muted">Your progress, notes, hint usage and reports are stored in this browser only (' + (storageOK ? "storage available" : "storage unavailable - progress will not persist") + ').</p>' +
      '<div class="row"><button id="export">Export progress (JSON)</button><button id="reset">Reset all progress</button></div>' +
      '<p class="small muted" style="margin-top:.5rem">' + done + ' of 30 levels closed.</p></div>';
  }

  /* ---------------- progress ---------------- */
  function viewProgress() {
    var done = doneCount();
    var items = [];
    for (var i = 1; i <= 30; i++) {
      var r = state.completed[String(i)];
      if (r) items.push({ id: i, pct: r.pct, at: r.at });
    }
    var avg = items.length ? Math.round(items.reduce(function (a, b) { return a + b.pct; }, 0) / items.length) : 0;
    var ach = [
      ["First case closed", done >= 1],
      ["Tier 1 complete (levels 1-10)", done >= 10],
      ["Tier 2 complete (levels 1-20)", done >= 20],
      ["Detection engineer (level 24)", isDone(24)],
      ["Forensics (level 27)", isDone(27)],
      ["Master SOC analyst (level 30)", isDone(30)],
      ["Clean sweep - every case at 90% or above", items.length === 30 && items.every(function (x) { return x.pct >= 90; })]
    ];
    var overallBuckets = {}; SKILLS.forEach(function (s) { overallBuckets[s] = { pts: 0, max: 0 }; });
    Object.keys(state.completed).forEach(function (k) {
      var rec = state.completed[k];
      if (!rec.grade || !rec.grade.items) return;
      rec.grade.items.forEach(function (it) {
        var s = classifySkill(it.label), pts = it.mark === "good" ? 1 : (it.mark === "part" ? 0.5 : 0);
        overallBuckets[s].pts += pts; overallBuckets[s].max += 1;
      });
    });
    var skillHtml = SKILLS.map(function (s) {
      var b = overallBuckets[s], v = b.max ? Math.round((b.pts / b.max) * 100) : null;
      if (v === null) return "";
      return '<div class="row" style="align-items:center;margin-bottom:.3rem"><span class="small" style="min-width:150px">' + s + '</span>' +
        '<div class="bar" style="flex:1"><i style="width:' + v + '%"></i></div><span class="small muted" style="min-width:40px;text-align:right">' + v + '%</span></div>';
    }).join("");

    return '<div class="card"><h1>Analyst progress</h1>' +
      '<div class="bar"><i style="width:' + (done / 30 * 100) + '%"></i></div>' +
      '<p class="small muted">' + done + '/30 closed, average score ' + avg + '%.</p></div>' +
      (skillHtml ? '<div class="card"><h2>Skills (across all closed cases)</h2>' + skillHtml + '</div>' : '') +
      '<div class="card"><h2>Scores by level</h2><div style="overflow:auto"><table class="data"><thead><tr><th>Level</th><th>Title</th><th>Score</th><th>Closed</th></tr></thead><tbody>' +
      items.map(function (x) {
        return '<tr><td>' + pad(x.id) + '</td><td>' + esc(levelById(x.id).title) + '</td><td>' + x.pct + '%</td><td>' + new Date(x.at).toISOString().slice(0, 16).replace("T", " ") + ' UTC</td></tr>';
      }).join("") + '</tbody></table></div>' + (items.length ? "" : '<p class="muted small">No cases closed yet.</p>') + '</div>' +
      '<div class="card"><h2>Achievements</h2>' + ach.map(function (a) {
        return '<div class="rev ' + (a[1] ? "good" : "bad") + '"><span class="m">' + (a[1] ? "&#10003;" : "&#9675;") + '</span><span>' + esc(a[0]) + '</span></div>';
      }).join("") + '</div>';
  }

  /* ---------------- book ---------------- */
  function chapter(n) {
    var base = null;
    for (var i = 0; i < BOOK.length; i++) if (BOOK[i].id === +n) base = BOOK[i];
    if (!base) return null;
    var ov = state.admin.chapters[String(n)];
    if (ov) return { id: base.id, title: ov.title || base.title, part: base.part, summary: ov.summary || base.summary, sections: ov.sections || base.sections };
    return base;
  }
  /* Field Guide (soc-book.html): two separate editions + PDF. Lock rule is the same as the existing book. */
  var GUIDE_EDITIONS = [
    { code: "en", name: "English Edition", note: "Natural professional English." },
    { code: "ur", name: "Roman Urdu Edition", note: "Alag likhi hui mukammal Roman Urdu kitab." }
  ];
  function guideButtons(compact) {
    return '<div class="row" style="gap:.8rem;flex-wrap:wrap;margin-top:.8rem">' + GUIDE_EDITIONS.map(function (e) {
      return '<div class="card" style="flex:1 1 240px;margin:0"><h3 style="margin-top:0">' + e.name + '</h3>' +
        (compact ? "" : '<p class="small muted">' + e.note + '</p>') +
        '<a class="btn-primary" style="text-decoration:none;display:inline-block;margin:.15rem .3rem .15rem 0;padding:.5rem .9rem;border-radius:8px" href="soc-book.html?lang=' + e.code + '" target="_blank" rel="noopener">Read online</a>' +
        '<a class="btn-ghost" style="text-decoration:none;display:inline-block;margin:.15rem 0;padding:.5rem .9rem;border-radius:8px" href="soc-book.html?lang=' + e.code + '&dl=1" target="_blank" rel="noopener">Download PDF</a></div>';
    }).join("") + '</div>';
  }
  function guideCard() {
    var complete = doneCount() >= 30;
    return '<div class="card"><div class="notice ok" style="text-align:center">' +
      (complete
        ? '<div style="font-family:var(--mono);letter-spacing:.14em;font-weight:700">30 / 30 LEVELS COMPLETE</div><h1 style="margin:.3rem 0">SOC Analyst Training Completed</h1><p style="margin:0">Congratulations! Your Zero-to-Hero SOC Analyst Book is now unlocked.</p>'
        : '<div style="font-family:var(--mono);letter-spacing:.1em;font-weight:700">BOOK ACCESS GRANTED FOR REVIEW</div><h1 style="margin:.3rem 0">SOC Analyst By Aashir Rajpoot</h1>') +
      '</div><h2>Zero to Hero \u2014 Complete SOC Analyst Field Guide</h2>' +
      '<p class="muted small">Two separate complete editions, with a searchable reader and a downloadable PDF (cover, page numbers and watermark included).</p>' +
      guideButtons(false) + '</div>';
  }
  function viewBook() {
    if (!bookUnlocked()) {
      var pct = Math.round(doneCount() / 30 * 100);
      return '<div class="card"><div class="locked-notice">' +
        '<div class="lk" style="font-size:2rem">&#128274;</div>' +
        '<div class="big">SOC Analyst Zero to Hero Book</div>' +
        '<p><strong>Complete all 30 training levels to unlock your complete field guide.</strong></p>' +
        '<div class="bar" style="max-width:420px;margin:.6rem auto"><i style="width:' + pct + '%"></i></div>' +
        '<p class="small" style="font-family:var(--mono)">' + doneCount() + ' / 30 Levels Completed</p>' +
        '<p class="small muted">English and Roman Urdu editions (with PDF download) unlock together.</p>' +
        '<button class="btn-primary" onclick="location.hash=\'#/levels\'">Back to the investigation path</button>' +
        '</div></div>';
    }
    var parts = {};
    BOOK.forEach(function (c) { (parts[c.part] = parts[c.part] || []).push(c); });
    var out = guideCard() + '<div class="card"><h1>Zero to Hero - SOC Analyst</h1>' +
      '<p class="muted small">Thirty chapters, unlocked by completing every investigation. Written to be read in order, but each chapter stands alone as reference.</p></div>';
    Object.keys(parts).forEach(function (p) {
      out += '<div class="card"><h2>' + esc(p) + '</h2><div class="chapters">' +
        parts[p].map(function (c) {
          return '<button class="chapter" onclick="location.hash=\'#/book/' + c.id + '\'">' +
            '<span class="small muted">CHAPTER ' + pad(c.id) + '</span><br><strong>' + esc(c.title) + '</strong><br>' +
            '<span class="small muted">' + esc(c.summary) + '</span></button>';
        }).join("") + '</div></div>';
    });
    return out;
  }
  function viewChapter(n) {
    if (!bookUnlocked()) return viewBook();
    var c = chapter(n);
    if (!c) return '<div class="card"><h2>Unknown chapter</h2></div>';
    if (state.book.read.indexOf(c.id) === -1) { state.book.read.push(c.id); save(); }
    return '<div class="card reader"><span class="small muted">CHAPTER ' + pad(c.id) + ' - ' + esc(c.part) + '</span>' +
      '<h1>' + esc(c.title) + '</h1><p class="muted">' + esc(c.summary) + '</p><hr>' +
      c.sections.map(function (s) { return '<h3>' + esc(s.h) + '</h3><p>' + esc(s.p) + '</p>'; }).join("") +
      '<hr><div class="row">' +
      (c.id > 1 ? '<button onclick="location.hash=\'#/book/' + (c.id - 1) + '\'">Previous chapter</button>' : '') +
      '<button onclick="location.hash=\'#/book\'">All chapters</button>' +
      (c.id < 30 ? '<button class="btn-primary" onclick="location.hash=\'#/book/' + (c.id + 1) + '\'">Next chapter</button>' : '') +
      '</div></div>';
  }

  /* ---------------- admin ---------------- */
  var adminOpen = false;
  function adminAuthed() { try { return sessionStorage.getItem("soc_admin") === "1"; } catch (e) { return adminOpen; } }
  function setAuthed(v) { adminOpen = v; try { sessionStorage.setItem("soc_admin", v ? "1" : "0"); } catch (e) { } }
  function sha(txt) {
    if (window.crypto && crypto.subtle && location.protocol !== "file:") {
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt)).then(function (b) {
        return Array.prototype.map.call(new Uint8Array(b), function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
      });
    }
    /* deterministic non-crypto fallback for file:// where SubtleCrypto is unavailable */
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < txt.length; i++) {
      h1 = (h1 ^ txt.charCodeAt(i)) >>> 0; h1 = (h1 * 16777619) >>> 0;
      h2 = (h2 + txt.charCodeAt(i) * (i + 7)) >>> 0;
    }
    return Promise.resolve("fb" + h1.toString(16) + h2.toString(16));
  }

  function viewAdmin() {
    if (!adminAuthed()) {
      var first = !state.admin.hash;
      return '<div class="card" style="max-width:520px">' +
        '<h1>Platform administration</h1>' +
        '<p class="small muted">' + (first
          ? "No passcode is set on this installation. There is no default or built-in passcode: choose one now and it is stored as a hash in this browser only."
          : "Enter the passcode set on this browser. If you have forgotten it, reset progress from the Tools page to clear it.") + '</p>' +
        '<label for="pw">Passcode</label><input type="password" id="pw" autocomplete="off">' +
        (first ? '<label for="pw2" style="margin-top:.5rem">Confirm passcode</label><input type="password" id="pw2" autocomplete="off">' : '') +
        '<div class="row" style="margin-top:.8rem"><button class="btn-primary" id="adminGo">' + (first ? "Set passcode" : "Unlock") + '</button>' +
        '<button onclick="location.hash=\'#/\'">Cancel</button></div></div>';
    }

    var rows = LEVELS.map(function (lv) {
      var r = state.completed[String(lv.id)];
      return '<tr><td>' + pad(lv.id) + '</td><td>' + esc(lv.title) + '</td><td>' + lv.qCount + '</td>' +
        '<td>' + lv.evidence.length + '</td><td>' + lv.evidence.reduce(function (a, s) { return a + s.rows.length; }, 0) + '</td>' +
        '<td>' + (r ? r.pct + "%" : (isUnlocked(lv.id) ? "open" : "locked")) + '</td>' +
        '<td><button class="btn-sm" data-adminunlock="' + lv.id + '">' + (r ? "Reopen" : "Mark closed") + '</button></td></tr>';
    }).join("");

    var chapOpts = BOOK.map(function (c) { return '<option value="' + c.id + '">' + pad(c.id) + " - " + esc(c.title) + '</option>'; }).join("");
    var evRows = LEVELS.reduce(function (a, l) { return a + l.evidence.reduce(function (b, s) { return b + s.rows.length; }, 0); }, 0);

    return '<div class="card"><div class="spread"><h1 style="margin:0">Platform administration</h1>' +
      '<button id="adminOut">Lock</button></div>' +
      '<p class="small muted" style="margin:.4rem 0 0">Local administration for this installation. Changes are stored in this browser and never leave it.</p></div>' +

      '<div class="grid cols-4">' +
      kpi(LEVELS.length, "Levels loaded") +
      kpi(LEVELS.reduce(function (a, l) { return a + l.qCount; }, 0), "Questions") +
      kpi(evRows, "Evidence rows") +
      kpi(BOOK.length, "Book chapters") +
      '</div>' +

      '<div class="card"><h2>System status</h2><div style="overflow:auto"><table class="data"><tbody>' +
      '<tr><th>Level data</th><td>' + (LEVELS.length === 30 ? "OK - 30 levels" : "WARNING - " + LEVELS.length + " levels") + '</td></tr>' +
      '<tr><th>Evaluation payload</th><td>' + (Object.keys(EVAL).length === 30 ? "OK - loaded and decoded" : "WARNING - " + Object.keys(EVAL).length + " entries") + '</td></tr>' +
      '<tr><th>Command reference</th><td>' + COMMANDS.length + ' entries</td></tr>' +
      '<tr><th>Browser storage</th><td>' + (storageOK ? "OK" : "UNAVAILABLE - progress will not persist") + '</td></tr>' +
      '<tr><th>Book access</th><td>' + (bookUnlocked() ? "UNLOCKED" : "LOCKED (" + doneCount() + "/30)") + '</td></tr>' +
      '</tbody></table></div></div>' +

      '<div class="card"><h2>Book management</h2>' +
      '<div class="row"><label for="chapSel" style="margin:0">Chapter</label>' +
      '<select id="chapSel" style="max-width:340px">' + chapOpts + '</select>' +
      '<button id="chapLoad">Load</button><button id="chapReset">Revert to original</button></div>' +
      '<div id="chapEdit" style="margin-top:.8rem"></div>' +
      '<div class="row" style="margin-top:.8rem"><button id="bookToggle">' +
      (state.book.unlockedOverride ? "Re-lock book (restore 30/30 requirement)" : "Grant book access for review") + '</button>' +
      '<span class="small muted">Current: ' + (bookUnlocked() ? "unlocked" : "locked") + '</span></div></div>' +

      '<div class="card"><h2>Levels, cases and hints</h2>' +
      '<div class="row" style="margin-bottom:.6rem"><button id="hintReset">Clear hint usage window</button>' +
      '<span class="small muted">Used ' + hintsUsedRecently() + '/' + HINT_MAX + ' in the last 24 hours. ' + esc(hintCountdown()) + '</span></div>' +
      '<div style="overflow:auto"><table class="data"><thead><tr><th>#</th><th>Title</th><th>Questions</th><th>Evidence sets</th><th>Rows</th><th>Status</th><th>Action</th></tr></thead><tbody>' +
      rows + '</tbody></table></div></div>';
  }

  /* ============================ command palette ============================ */
  function paletteHTML() {
    var cats = ["ALL", "LINUX", "WINDOWS", "NETWORK", "INVESTIGATION"];
    return '<div class="palette" role="dialog" aria-modal="true" aria-label="Command reference">' +
      '<header><strong>Command reference</strong>' +
      '<input type="text" id="cmdq" placeholder="Search commands, flags or use cases" style="flex:1;min-width:180px">' +
      cats.map(function (c) { return '<button class="btn-sm" data-cat="' + c + '">' + c + '</button>'; }).join("") +
      '<button class="btn-sm" id="palclose" aria-label="Close">Close (ESC)</button></header>' +
      '<div class="list" id="cmdlist"></div></div>';
  }
  var palCat = "ALL";
  function renderCommands() {
    var q = norm(($("#cmdq") || {}).value || "");
    var list = COMMANDS.filter(function (c) {
      if (palCat !== "ALL" && c.cat !== palCat) return false;
      if (!q) return true;
      return norm(c.command + " " + c.what + " " + c.why + " " + c.example + " " + c.useCase + " " + (c.flags || []).join(" ")).indexOf(q) !== -1;
    });
    $("#cmdlist").innerHTML = list.length ? list.map(function (c, i) {
      return '<div class="cmd-item"><div class="spread"><h4>' + esc(c.command) + '</h4>' +
        '<span><span class="tag">' + esc(c.cat) + '</span> <button class="btn-sm" data-copy="' + i + '">Copy example</button></span></div>' +
        '<p class="small" style="margin:.2rem 0">' + esc(c.what) + '</p>' +
        '<p class="small muted" style="margin:.2rem 0"><strong>Why SOC uses it:</strong> ' + esc(c.why) + '</p>' +
        '<div class="ex" data-ex="' + i + '">' + esc(c.example) + '</div>' +
        ((c.flags && c.flags.length) ? '<p class="small flag"><strong>Flags:</strong> ' + c.flags.map(esc).join("  |  ") + '</p>' : '') +
        '<p class="small muted" style="margin:.2rem 0 0"><strong>Use case:</strong> ' + esc(c.useCase) + '</p></div>';
    }).join("") : '<p class="muted small">No commands match that search.</p>';
    $$("#cmdlist [data-copy]").forEach(function (b) {
      b.addEventListener("click", function () {
        var txt = $('[data-ex="' + b.dataset.copy + '"]').textContent;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(function () { toast("Example copied."); },
            function () { toast("Copy blocked by the browser - select the text manually."); });
        } else { toast("Clipboard unavailable - select the text manually."); }
      });
    });
    return list.length;
  }
  function openPalette() {
    var ov = $("#palette");
    if (!ov.innerHTML.trim()) ov.innerHTML = paletteHTML();
    ov.hidden = false;
    renderCommands();
    var q = $("#cmdq"); if (q) q.focus();
    $("#palclose").onclick = closePalette;
    $("#cmdq").oninput = renderCommands;
    $$("#palette [data-cat]").forEach(function (b) {
      b.onclick = function () { palCat = b.dataset.cat; renderCommands(); };
    });
    ov.onclick = function (e) { if (e.target === ov) closePalette(); };
  }
  function closePalette() { $("#palette").hidden = true; }

  /* CTRL + SHIFT + C then D */
  var armed = 0;
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !$("#palette").hidden) { closePalette(); return; }
    if (e.ctrlKey && e.shiftKey) {
      var k = (e.key || "").toLowerCase();
      if (k === "c") { armed = Date.now(); return; }
      if (k === "d" && Date.now() - armed < 1500) {
        e.preventDefault(); armed = 0;
        if ($("#palette").hidden) openPalette(); else closePalette();
      }
    }
  });

  /* ============================ terminal ============================ */
  function termFiles(lv) {
    var f = {};
    lv.evidence.forEach(function (s, i) {
      var name = s.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") + ".log";
      f[name] = { rows: s.rows, idx: i };
    });
    return f;
  }
  function termRun(lv, line, echo) {
    var files = termFiles(lv);
    var out = [];
    var parts = line.split("|").map(function (s) { return s.trim(); });
    var buf = null;

    function resolve(name) {
      if (!name) return null;
      if (files[name]) return files[name].rows.slice();
      var keys = Object.keys(files).filter(function (k) { return k.indexOf(name.replace(/^\.\//, "")) === 0; });
      return keys.length ? files[keys[0]].rows.slice() : null;
    }

    for (var p = 0; p < parts.length; p++) {
      var tok = parts[p].match(/"[^"]*"|\S+/g) || [];
      var cmd = (tok[0] || "").toLowerCase();
      var args = tok.slice(1).map(function (a) { return a.replace(/^"|"$/g, ""); });

      if (cmd === "help") {
        buf = [
          "Simulated read-only analysis shell. Nothing is executed on your machine.",
          "  ls                      list evidence files mounted for this case",
          "  cat <file>              print an evidence file",
          "  head -n N <file>        first N lines",
          "  tail -n N <file>        last N lines",
          "  grep [-i] PATTERN <file>  filter lines",
          "  wc -l <file>            count lines",
          "  whoami | id | hostname | date",
          "  clear                   clear the terminal",
          "Pipes are supported, e.g.  cat auth.log | grep -i failed | wc -l"
        ];
      } else if (cmd === "ls") {
        buf = Object.keys(files).map(function (k) { return "-r--r-----  analyst  soc  " + files[k].rows.length + " rows  " + k; });
      } else if (cmd === "cat") {
        buf = resolve(args[0]) || ["cat: " + (args[0] || "") + ": no such evidence file"];
      } else if (cmd === "head" || cmd === "tail") {
        var n = 10, rest = [];
        for (var i = 0; i < args.length; i++) {
          if (args[i] === "-n") { n = parseInt(args[++i], 10) || 10; }
          else rest.push(args[i]);
        }
        var src = buf || resolve(rest[0]);
        if (!src) buf = [cmd + ": no such evidence file"];
        else buf = cmd === "head" ? src.slice(0, n) : src.slice(-n);
      } else if (cmd === "grep") {
        var ci = false, pat = null, file = null;
        args.forEach(function (a) {
          if (a === "-i") ci = true;
          else if (a[0] === "-") return;
          else if (pat === null) pat = a;
          else file = a;
        });
        var src2 = buf || resolve(file);
        if (!src2) buf = ["grep: no input - give a file or pipe one in"];
        else if (pat === null) buf = ["grep: missing pattern"];
        else {
          var needle = ci ? pat.toLowerCase() : pat;
          buf = src2.filter(function (r) { return (ci ? r.toLowerCase() : r).indexOf(needle) !== -1; });
          if (!buf.length) buf = ["(no matching lines)"];
        }
      } else if (cmd === "wc") {
        var src3 = buf || resolve(args[args.length - 1]);
        buf = [String(src3 ? src3.length : 0)];
      } else if (cmd === "whoami") { buf = ["analyst"]; }
      else if (cmd === "id") { buf = ["uid=1101(analyst) gid=1101(soc) groups=1101(soc),27(readonly)"]; }
      else if (cmd === "hostname") { buf = ["soc-jump-01"]; }
      else if (cmd === "date") { buf = [new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC"]; }
      else if (cmd === "clear") { return { clear: true }; }
      else if (cmd === "") { buf = []; }
      else { buf = [cmd + ": command not available in the simulated shell. Type help."]; }
    }
    out = buf || [];
    return { lines: out.slice(0, 400), truncated: (buf || []).length > 400 };
  }

  /* ============================ wiring ============================ */
  function afterRender(r) {
    /* generic nav */
    $$("[data-open]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = +b.dataset.open;
        if (!isUnlocked(id)) { toast("Level " + pad(id) + " is locked. Complete level " + pad(id - 1) + " first."); return; }
        go("#/level/" + id);
      });
    });
    $$("[data-stage]").forEach(function (b) {
      b.addEventListener("click", function () {
        view.stage[+b.dataset.level] = b.dataset.stage;
        render();
      });
    });
    var op = $("#openpal"); if (op) op.addEventListener("click", openPalette);

    if (r.page === "level") { wireWorkspace(+r.arg); wireTrainingFlow(+r.arg); }
    if (r.page === "tools") wireTools();
    if (r.page === "admin") wireAdmin();
  }

  function wireTrainingFlow(id) {
    var lv = levelById(id);
    if (!lv) return;

    /* theory: mark chapter learned */
    $$("[data-readchapter]").forEach(function (b) {
      b.addEventListener("click", function () {
        var wasDone = theoryDone(lv);
        markChapterRead(lv, b.dataset.readchapter);
        if (!wasDone && theoryDone(lv) && window.SOCPopup) window.SOCPopup.trigger("theory", lv.id);
        render();
      });
    });

    /* knowledge test */
    $$("[data-quizq]").forEach(function (r) {
      r.addEventListener("change", function () {
        var qs = quizStateOf(lv.id);
        qs.answers[r.dataset.quizq] = +r.value;
        save();
      });
    });
    var qsub = $("[data-quizsubmit]");
    if (qsub) qsub.addEventListener("click", function () {
      var set = currentQuizSet(lv), qs = quizStateOf(lv.id);
      var unanswered = set.filter(function (it) { return qs.answers[it.id] === undefined; }).length;
      if (unanswered && !confirm(unanswered + " question(s) unanswered. Submit anyway? Unanswered questions score as incorrect.")) return;
      var res = gradeQuizSet(lv);
      view.quizResult[lv.id] = res;
      if (res.pct === 100 && window.SOCPopup) window.SOCPopup.trigger("quiz", lv.id);
      render();
    });
    var qretry = $("[data-quizretry]");
    if (qretry) qretry.addEventListener("click", function () {
      delete view.quizResult[lv.id];
      newQuizSet(lv);
      render();
    });

    /* guided investigation */
    var g = guidedFor(lv), gs = guidedStateOf(lv.id);
    var stepIdx = Math.min(gs.step || 0, g.steps.length - 1);
    var step = g.steps[stepIdx];

    var grev = $("[data-guidedreveal]");
    if (grev) grev.addEventListener("click", function () {
      if (gs.seen.indexOf(step.id) === -1) gs.seen.push(step.id);
      save(); render();
    });
    var gsearch = $("[data-guidedsearch]");
    if (gsearch) gsearch.addEventListener("click", function () {
      var val = norm(($("#guidedSearch") || {}).value || "");
      var expect = (step.expect || []).map(norm);
      var hit = !val ? false : expect.some(function (e) { return e && (val.indexOf(e) !== -1 || e.indexOf(val) !== -1); });
      if (!hit) { toast("Not quite - try a different search term. " + (step.hintText || "")); return; }
      if (gs.seen.indexOf(step.id) === -1) gs.seen.push(step.id);
      save(); render();
    });
    var gchoiceSub = $("[data-guidedchoicesubmit]");
    if (gchoiceSub) gchoiceSub.addEventListener("click", function () {
      var picked = $('input[name="guidedchoice"]:checked');
      if (!picked) { toast("Ek option select karo pehle."); return; }
      var idx = +picked.value;
      toast(idx === step.correctIndex ? "Correct." : "Not quite - read the explanation below.");
      if (gs.seen.indexOf(step.id) === -1) gs.seen.push(step.id);
      save(); render();
    });
    var gnext = $("[data-guidednext]");
    if (gnext) gnext.addEventListener("click", function () {
      gs.step = stepIdx + 1; save(); render();
    });
    var gfinish = $("[data-guidedfinish]");
    if (gfinish) gfinish.addEventListener("click", function () {
      gs.done = true; save();
      view.stage[lv.id] = "work";
      toast("Guided Investigation Completed. Real Investigation Unlocked.");
      if (window.SOCPopup) window.SOCPopup.trigger("guided", lv.id);
      render();
    });
  }

  function wireWorkspace(id) {
    var lv = levelById(id);
    if (!lv || view.stage[id] !== "work") return;
    var w = work(id);

    var search = $("#search");
    if (search) {
      var reflow = function () {
        $("#evidence").innerHTML = evidenceHTML(lv, search.value);
        wirePicks(lv);
      };
      search.addEventListener("input", reflow);
      $("#clearsearch").addEventListener("click", function () { search.value = ""; reflow(); });
      $("#clearpicks").addEventListener("click", function () {
        w.picks = []; save(); reflow();
        $("#timeline").innerHTML = timelineHTML(lv);
        $("#pickcount").textContent = "0 rows on timeline";
      });
    }
    wirePicks(lv);

    $$(".ans").forEach(function (el) {
      el.addEventListener("input", function () { w.answers[el.dataset.q] = el.value; save(); });
      el.addEventListener("change", function () { w.answers[el.dataset.q] = el.value; save(); });
    });
    $$("[data-hint]").forEach(function (b) {
      b.addEventListener("click", function () {
        var tok = b.dataset.hint;
        if (hintRevealed(tok)) return;
        if (!revealHint(tok)) {
          toast("No hints left. " + hintCountdown());
          return;
        }
        render();
      });
    });
    var notes = $("#notes");
    if (notes) notes.addEventListener("input", function () { w.notes = notes.value; save(); });
    ["decision", "severity", "recommend"].forEach(function (f) {
      var el = $("#" + f);
      if (el) el.addEventListener("change", function () { w[f] = el.value; save(); });
      if (el && f === "recommend") el.addEventListener("input", function () { w[f] = el.value; save(); });
    });
    $$(".rep").forEach(function (t) {
      t.addEventListener("input", function () {
        w.report = w.report || {};
        w.report[t.dataset.sec] = t.value;
        var sec = lv.report.filter(function (s) { return s.id === t.dataset.sec; })[0];
        var c = $('[data-count="' + t.dataset.sec + '"]');
        if (c) c.textContent = t.value.trim().length + " / " + sec.min;
        save();
      });
    });

    var sub = $("#submit");
    if (sub) sub.addEventListener("click", function () {
      var missing = [];
      if (!w.decision) missing.push("a decision");
      if (!w.severity) missing.push("a severity");
      if (!norm(w.recommend)) missing.push("a recommended action");
      var unanswered = lv.questions.filter(function (q) { return !norm(w.answers[q.id]); }).length;
      if (unanswered) missing.push(unanswered + " unanswered question" + (unanswered > 1 ? "s" : ""));
      if (missing.length) {
        if (!confirm("This investigation is missing " + missing.join(", ") + ".\n\nSubmit anyway? Missing items score zero.")) return;
      }
      var g = grade(lv);
      var seconds = Math.round((Date.now() - (w.startedAt || Date.now())) / 1000);
      if (g.pct >= PASS) {
        state.completed[String(lv.id)] = {
          pct: g.pct, at: Date.now(), seconds: seconds,
          decision: w.decision, severity: w.severity, grade: g
        };
      }
      view.stage[lv.id] = "review";
      view.lastGrade = g;
      save();
      if (g.pct >= PASS && lv.id === 30) toast("Master investigation closed. Book unlocked.");
      if (window.SOCPopup) window.SOCPopup.trigger(g.pct >= PASS ? "assessment" : "investigation", lv.id);
      render();
    });

    /* terminal */
    var ti = $("#termin"), tw = $("#term");
    if (ti) {
      var hist = [], hp = -1;
      ti.addEventListener("keydown", function (e) {
        if (e.key === "ArrowUp") { if (hist.length) { hp = Math.max(0, (hp === -1 ? hist.length : hp) - 1); ti.value = hist[hp] || ""; e.preventDefault(); } return; }
        if (e.key === "ArrowDown") { if (hp !== -1) { hp = Math.min(hist.length - 1, hp + 1); ti.value = hist[hp] || ""; } return; }
        if (e.key !== "Enter") return;
        var line = ti.value; ti.value = ""; if (!line.trim()) return;
        hist.push(line); hp = -1;
        tw.innerHTML += '<span class="cmd">analyst@soc:~$ ' + esc(line) + "</span>\n";
        var res;
        try { res = termRun(lv, line); }
        catch (err) { res = { lines: ["shell error: " + err.message] }; }
        if (res.clear) { tw.innerHTML = ""; return; }
        tw.innerHTML += esc(res.lines.join("\n")) + (res.truncated ? "\n(output truncated at 400 lines)" : "") + "\n";
        tw.scrollTop = tw.scrollHeight;
      });
    }
  }

  function wirePicks(lv) {
    var w = work(lv.id);
    $$("[data-pick]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        var p = cb.dataset.pick, i = w.picks.indexOf(p);
        if (cb.checked && i === -1) w.picks.push(p);
        if (!cb.checked && i !== -1) w.picks.splice(i, 1);
        cb.closest(".logrow").classList.toggle("picked", cb.checked);
        save();
        var tl = $("#timeline"); if (tl) tl.innerHTML = timelineHTML(lv);
        var pc = $("#pickcount"); if (pc) pc.textContent = w.picks.length + " rows on timeline";
      });
    });
  }

  function wireTools() {
    var ex = $("#export");
    if (ex) ex.addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "soc-progress-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });
    var rs = $("#reset");
    if (rs) rs.addEventListener("click", function () {
      if (!confirm("Reset every level, note, report and hint record on this browser? This cannot be undone.")) return;
      state = fresh(); save(); setAuthed(false); view.stage = {};
      toast("Progress reset."); go("#/");
      render();
    });
  }

  function wireAdmin() {
    var go1 = $("#adminGo");
    if (go1) {
      go1.addEventListener("click", function () {
        var pw = $("#pw").value, pw2 = $("#pw2") ? $("#pw2").value : null;
        if (!pw || pw.length < 4) { toast("Use at least 4 characters."); return; }
        if (pw2 !== null && pw !== pw2) { toast("Passcodes do not match."); return; }
        sha(pw).then(function (h) {
          if (!state.admin.hash) { state.admin.hash = h; save(); setAuthed(true); render(); return; }
          if (h === state.admin.hash) { setAuthed(true); render(); }
          else toast("Incorrect passcode.");
        });
      });
      var pwEl = $("#pw");
      pwEl.addEventListener("keydown", function (e) { if (e.key === "Enter") go1.click(); });
      return;
    }
    var out = $("#adminOut");
    if (out) out.addEventListener("click", function () { setAuthed(false); render(); });

    var bt = $("#bookToggle");
    if (bt) bt.addEventListener("click", function () {
      state.book.unlockedOverride = !state.book.unlockedOverride; save(); render();
    });
    var hr = $("#hintReset");
    if (hr) hr.addEventListener("click", function () {
      state.hints.used = []; save(); toast("Hint window cleared."); render();
    });
    $$("[data-adminunlock]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = String(b.dataset.adminunlock);
        if (state.completed[id]) delete state.completed[id];
        else state.completed[id] = { pct: 100, at: Date.now(), seconds: 0, decision: "", severity: "", grade: null, manual: true };
        save(); render();
      });
    });

    var load1 = $("#chapLoad");
    if (load1) {
      var draw = function () {
        var id = $("#chapSel").value, c = chapter(id);
        $("#chapEdit").innerHTML =
          '<label for="chTitle">Title</label><input type="text" id="chTitle" value="' + esc(c.title) + '">' +
          '<label for="chSum" style="margin-top:.5rem">Summary</label><input type="text" id="chSum" value="' + esc(c.summary) + '">' +
          '<label for="chBody" style="margin-top:.5rem">Sections (one per block: heading on the first line, body on the next)</label>' +
          '<textarea id="chBody" style="min-height:220px">' +
          esc(c.sections.map(function (s) { return s.h + "\n" + s.p; }).join("\n\n")) + '</textarea>' +
          '<div class="row" style="margin-top:.6rem"><button class="btn-primary" id="chSave">Save chapter</button>' +
          '<span class="small muted">' + (state.admin.chapters[String(id)] ? "This chapter has local edits." : "Original text.") + '</span></div>';
        $("#chSave").addEventListener("click", function () {
          var blocks = $("#chBody").value.split(/\n\s*\n/).map(function (b) {
            var lines = b.split("\n");
            return { h: (lines.shift() || "").trim(), p: lines.join(" ").trim() };
          }).filter(function (s) { return s.h || s.p; });
          state.admin.chapters[String(id)] = { title: $("#chTitle").value, summary: $("#chSum").value, sections: blocks };
          save(); toast("Chapter " + id + " saved."); draw();
        });
      };
      load1.addEventListener("click", draw);
      $("#chapSel").addEventListener("change", draw);
      $("#chapReset").addEventListener("click", function () {
        delete state.admin.chapters[String($("#chapSel").value)];
        save(); toast("Reverted to the original text."); draw();
      });
      draw();
    }
  }

  /* ============================ boot ============================ */
  function boot() {
    load();
    if (!LEVELS.length) {
      $("#main").innerHTML = '<div class="card"><h2>Data files did not load</h2>' +
        '<p>levels.js, eval.js, book.js and commands.js must sit in the same folder as index.html. ' +
        'If you opened this from a zip, extract the whole folder first.</p></div>';
      return;
    }
    $$("#nav button").forEach(function (b) {
      b.addEventListener("click", function () { go("#/" + b.dataset.page); });
    });
    $("#fab").addEventListener("click", openPalette);
    $("#adminlink").addEventListener("click", function () { go("#/admin"); });
    window.addEventListener("error", function (e) { console.warn("[soc] runtime error:", e.message); });
    render();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
