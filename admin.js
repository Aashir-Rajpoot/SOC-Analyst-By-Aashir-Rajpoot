/* SOC Analyst Training Platform - Admin Panel logic
   Standalone script for admin.html only. Never included on index.html or
   about.html, and never touches EVAL_B64 / eval.js (that file is not even
   loaded here) so no graded answer key is reachable from this panel.
   Reads window.LEVELS / window.BOOK / window.COMMANDS, which are already
   the public, key-stripped bundles the main site itself uses. */
(function () {
  "use strict";

  /* ============================ tiny helpers ============================ */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /* Non-cryptographic hash (FNV-1a) - same spirit as this platform's
     existing file:// fallback hashing described in the README. This is a
     frontend/local training convenience, NOT production-grade security;
     see the note on the login screen and the README. */
  function hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h.toString(16);
  }

  var LEVELS = window.LEVELS || [];
  var BOOK = window.BOOK || [];

  /* ============================ storage keys ============================ */
  var K_SESSION = "soc_admin_session_v1";
  var K_CREDS = "soc_admin_credentials_v1";
  var K_LEVEL_OVERRIDES = "soc_admin_level_overrides_v1";
  var K_SECTIONS = "soc_admin_sections_v1";
  var K_CUSTOM_LEVELS = "soc_admin_custom_levels_v1";
  var K_APP_STATE = "soc_ops_state_v2";      // read-only: existing platform progress
  var K_ANALYST_NAME = "soc_analyst_name_v1"; // read-only: written by popup.js

  function readJSON(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function writeJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  /* ============================ credentials ============================ */
  function creds() {
    var c = readJSON(K_CREDS, null);
    if (!c) { c = { u: hash("admin"), p: hash("admin") }; writeJSON(K_CREDS, c); }
    return c;
  }
  function checkLogin(u, p) {
    var c = creds();
    return hash(u) === c.u && hash(p) === c.p;
    /* Production upgrade path: replace this with, e.g.,
       return fetch('/api/admin-login',{method:'POST',body:JSON.stringify({u,p})})
         .then(r => r.ok); and make the caller async. */
  }
  function setCredentials(u, p) { writeJSON(K_CREDS, { u: hash(u), p: hash(p) }); }

  function isAuthed() { try { return sessionStorage.getItem(K_SESSION) === "1"; } catch (e) { return false; } }
  function setAuthed(v) { try { if (v) sessionStorage.setItem(K_SESSION, "1"); else sessionStorage.removeItem(K_SESSION); } catch (e) {} }

  /* ============================ level overrides ============================ */
  function levelOverrides() { return readJSON(K_LEVEL_OVERRIDES, {}); }
  function setLevelOverride(id, patch) {
    var o = levelOverrides();
    o[String(id)] = Object.assign({}, o[String(id)], patch);
    writeJSON(K_LEVEL_OVERRIDES, o);
  }
  function clearLevelOverride(id) {
    var o = levelOverrides();
    delete o[String(id)];
    writeJSON(K_LEVEL_OVERRIDES, o);
  }
  function isLevelEnabled(id) {
    var o = levelOverrides()[String(id)];
    return !o || o.enabled !== false;
  }
  function displayTitle(lv) {
    var o = levelOverrides()[String(lv.id)];
    return (o && o.title) ? o.title : lv.title;
  }

  /* ============================ section flags ============================ */
  var SECTION_DEFS = [
    { key: "theory", label: "Theory", desc: "Chapter-by-chapter theory content before the knowledge test.", core: false },
    { key: "quiz", label: "Knowledge Test", desc: "10-question, 100%-to-pass MCQ gate before Guided Investigation.", core: false },
    { key: "guided", label: "Guided Investigation", desc: "Step-by-step teaching walkthrough before the Real Investigation.", core: false },
    { key: "realInvestigation", label: "Real Investigation", desc: "The graded case workspace. Core to the platform - always on.", core: true },
    { key: "assessment", label: "Assessment", desc: "Scored feedback and skill breakdown after submission. Core - always on.", core: true },
    { key: "book", label: "SOC Analyst Book", desc: "The 30-chapter analyst book, unlocked after Level 30.", core: false },
    { key: "about", label: "About", desc: "The public About / profile page and its nav link.", core: false },
    { key: "ai", label: "AI Assistant", desc: "The site-wide floating \u201CAsk AI\u201D chat widget.", core: false }
  ];
  function sectionFlags() {
    var f = readJSON(K_SECTIONS, {});
    SECTION_DEFS.forEach(function (s) { if (f[s.key] === undefined) f[s.key] = true; });
    return f;
  }
  function setSectionFlag(key, val) {
    var f = sectionFlags(); f[key] = val; writeJSON(K_SECTIONS, f);
  }

  /* ============================ custom (admin-authored) levels ============================ */
  function customLevels() { return readJSON(K_CUSTOM_LEVELS, []); }
  function saveCustomLevels(list) { writeJSON(K_CUSTOM_LEVELS, list); }

  /* ============================ modal ============================ */
  var modalBackdrop = $("#modalBackdrop"), modalBody = $("#modalBody");
  function closeModal() { modalBackdrop.classList.remove("open"); modalBody.innerHTML = ""; }
  function openModal(html) { modalBody.innerHTML = html; modalBackdrop.classList.add("open"); }
  modalBackdrop.addEventListener("click", function (e) { if (e.target === modalBackdrop) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

  function confirmDialog(title, sub, okLabel, danger, onOk) {
    openModal(
      '<h3>' + esc(title) + '</h3><p class="sub">' + esc(sub) + '</p>' +
      '<div class="a-modal__actions"><button class="a-btn" id="mCancel">Cancel</button>' +
      '<button class="a-btn ' + (danger ? "danger" : "primary") + '" id="mOk">' + esc(okLabel) + '</button></div>'
    );
    $("#mCancel").addEventListener("click", closeModal);
    $("#mOk").addEventListener("click", function () { closeModal(); onOk(); });
  }

  /* ============================ login ============================ */
  var loginScreen = $("#loginScreen"), shell = $("#shell");
  $("#loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var u = $("#loginUser").value.trim(), p = $("#loginPass").value;
    if (checkLogin(u, p)) {
      setAuthed(true);
      $("#loginErr").textContent = "";
      showShell();
    } else {
      $("#loginErr").textContent = "Incorrect username or password.";
    }
  });
  $("#logoutBtn").addEventListener("click", function () {
    setAuthed(false);
    shell.classList.remove("show");
    loginScreen.style.display = "flex";
    $("#loginPass").value = "";
  });

  function showShell() {
    loginScreen.style.display = "none";
    shell.classList.add("show");
    renderTab(currentTab);
  }

  /* ============================ tabs / router ============================ */
  var TABS = {
    overview: { title: "Dashboard Overview", sub: "Snapshot of the training platform.", render: renderOverview },
    levels: { title: "Levels Management", sub: "Enable, disable, rename and review all 30 investigation levels.", render: renderLevels },
    sections: { title: "Section Management", sub: "Turn platform-wide sections on or off.", render: renderSections },
    book: { title: "SOC Analyst Book", sub: "Browse the complete, existing 30-chapter analyst book.", render: renderBook },
    theme: { title: "Theme Manager", sub: "20+ professional color themes, applied site-wide.", render: renderTheme },
    progress: { title: "User / Progress Data", sub: "Read-only snapshot of this browser's training progress.", render: renderProgress },
    settings: { title: "Site Settings", sub: "Admin credentials and platform housekeeping.", render: renderSettings }
  };
  var currentTab = "overview";

  function renderTab(tab) {
    currentTab = tab;
    $$(".admin-side button[data-tab]").forEach(function (b) { b.classList.toggle("active", b.dataset.tab === tab); });
    $("#pageTitle").textContent = TABS[tab].title;
    $("#pageSub").textContent = TABS[tab].sub;
    $("#tabBody").innerHTML = "";
    TABS[tab].render($("#tabBody"));
  }
  $$(".admin-side button[data-tab]").forEach(function (b) {
    b.addEventListener("click", function () { renderTab(b.dataset.tab); });
  });

  /* ============================ Dashboard Overview ============================ */
  function renderOverview(root) {
    var enabledCount = LEVELS.filter(function (lv) { return isLevelEnabled(lv.id); }).length;
    var sec = sectionFlags();
    var secOnCount = SECTION_DEFS.filter(function (s) { return sec[s.key]; }).length;
    var state = readJSON(K_APP_STATE, null);
    var completed = state ? Object.keys(state.completed || {}).length : 0;
    var name = (localStorage.getItem(K_ANALYST_NAME) || "").trim();

    root.innerHTML =
      '<div class="a-grid a-cols-4" style="margin-bottom:1.4rem">' +
      kpi(LEVELS.length, "Total authored levels") +
      kpi(enabledCount + "/" + LEVELS.length, "Levels currently enabled") +
      kpi(secOnCount + "/" + SECTION_DEFS.length, "Sections enabled") +
      kpi(BOOK.length, "Book chapters") +
      '</div>' +
      '<div class="a-grid a-cols-2">' +
      '<div class="a-card"><h3 style="margin-top:0">This browser\u2019s progress</h3>' +
      (state ?
        '<p class="small" style="color:var(--muted)">Analyst on record: <strong>' + esc(name || "(not set yet)") + '</strong></p>' +
        '<p class="small" style="color:var(--muted)">' + completed + ' / 30 levels closed in this browser.</p>' :
        '<p class="a-empty">No local progress recorded in this browser yet.</p>') +
      '<a class="a-btn" href="index.html" target="_blank" rel="noopener">Open student view &rarr;</a></div>' +
      '<div class="a-card"><h3 style="margin-top:0">Quick actions</h3>' +
      '<div class="a-row">' +
      '<button class="a-btn" data-goto="levels">Manage levels</button>' +
      '<button class="a-btn" data-goto="sections">Manage sections</button>' +
      '<button class="a-btn" data-goto="theme">Change theme</button>' +
      '<button class="a-btn" data-goto="book">Open book</button>' +
      '</div></div></div>';

    $$("[data-goto]", root).forEach(function (b) { b.addEventListener("click", function () { renderTab(b.dataset.goto); }); });
  }
  function kpi(n, label) {
    return '<div class="a-card a-kpi"><div class="n">' + n + '</div><div class="l">' + esc(label) + '</div></div>';
  }

  /* ============================ Levels Management ============================ */
  function stageStatus(lv) {
    var theory = lv.chapters && lv.chapters.length ? "Authored" : (lv.theory ? "Auto-generated" : "\u2014");
    var quiz = lv.quizBank && lv.quizBank.length ? "Authored bank" : (lv.questions && lv.questions.length ? "Auto-generated" : "\u2014");
    var guided = lv.guided ? "Authored" : "Auto-generated";
    return { theory: theory, quiz: quiz, guided: guided };
  }
  function renderLevels(root) {
    var rows = LEVELS.map(function (lv) {
      var enabled = isLevelEnabled(lv.id);
      var st = stageStatus(lv);
      var title = displayTitle(lv);
      var overridden = levelOverrides()[String(lv.id)] && levelOverrides()[String(lv.id)].title;
      return '<tr>' +
        '<td>' + pad(lv.id) + (lv.master ? ' <span class="a-pill">MASTER</span>' : "") + '</td>' +
        '<td>' + esc(title) + (overridden ? ' <span class="a-pill">renamed</span>' : "") + '<div style="color:var(--muted);font-size:.76rem">' + esc(lv.domain || "") + '</div></td>' +
        '<td><span class="a-pill ' + (enabled ? "on" : "off") + '">' + (enabled ? "ENABLED" : "DISABLED") + '</span></td>' +
        '<td><span class="a-pill auto">' + st.theory + '</span></td>' +
        '<td><span class="a-pill auto">' + st.quiz + '</span></td>' +
        '<td><span class="a-pill auto">' + st.guided + '</span></td>' +
        '<td><span class="a-pill on">Available</span></td>' +
        '<td><span class="a-pill on">Available</span></td>' +
        '<td class="a-row">' +
        '<button class="a-btn" data-edit="' + lv.id + '">Edit</button>' +
        '<button class="a-btn ' + (enabled ? "danger" : "primary") + '" data-toggle="' + lv.id + '">' + (enabled ? "Disable" : "Enable") + '</button>' +
        (overridden || !enabled ? '<button class="a-btn" data-restore="' + lv.id + '">Restore</button>' : "") +
        '</td></tr>';
    }).join("");

    var custom = customLevels();
    var customRows = custom.map(function (c) {
      return '<tr><td>' + esc(c.id) + '</td><td>' + esc(c.title) + '<div style="color:var(--muted);font-size:.76rem">' + esc(c.domain || "") + '</div></td>' +
        '<td><span class="a-pill on">ENABLED</span></td><td colspan="4"><span class="a-pill">Admin-authored catalog entry</span></td>' +
        '<td class="a-row"><button class="a-btn danger" data-delcustom="' + esc(c.id) + '">Delete</button></td></tr>';
    }).join("");

    root.innerHTML =
      '<div class="a-note">The 30 authored levels are never deleted here. \u201CDisable\u201D hides a level as temporarily unavailable while keeping all theory, questions, guided steps and the graded answer key intact and restorable. \u201CEdit\u201D only changes the display title shown to students - it does not touch case content, evidence or grading. Reordering the core 30 is not offered here because unlocking is structural (Level N requires Level N-1 closed) - reordering custom levels below is supported.</div>' +
      '<div class="a-row" style="margin-bottom:1rem"><button class="a-btn primary" id="addLevelBtn">+ Add Level (catalog entry)</button></div>' +
      '<div style="overflow-x:auto"><table class="a-table"><thead><tr>' +
      '<th>#</th><th>Title</th><th>Status</th><th>Theory</th><th>Knowledge Test</th><th>Guided Inv.</th><th>Real Inv.</th><th>Assessment</th><th>Actions</th>' +
      '</tr></thead><tbody>' + rows + customRows + '</tbody></table></div>';

    $("#addLevelBtn").addEventListener("click", openAddLevelModal);
    $$("[data-edit]", root).forEach(function (b) { b.addEventListener("click", function () { openEditLevelModal(+b.dataset.edit); }); });
    $$("[data-toggle]", root).forEach(function (b) {
      b.addEventListener("click", function () {
        var id = +b.dataset.toggle, enabled = isLevelEnabled(id);
        if (enabled) {
          confirmDialog("Disable Level " + pad(id) + "?", "Students will see it as temporarily unavailable. Nothing is deleted - you can re-enable it any time.", "Disable", true, function () {
            setLevelOverride(id, { enabled: false }); renderLevels(root);
          });
        } else {
          setLevelOverride(id, { enabled: true }); renderLevels(root);
        }
      });
    });
    $$("[data-restore]", root).forEach(function (b) {
      b.addEventListener("click", function () { clearLevelOverride(+b.dataset.restore); renderLevels(root); });
    });
    $$("[data-delcustom]", root).forEach(function (b) {
      b.addEventListener("click", function () {
        confirmDialog("Delete this catalog entry?", "This permanently removes this admin-authored catalog entry (it was never part of the original 30 levels).", "Delete", true, function () {
          saveCustomLevels(customLevels().filter(function (c) { return c.id !== b.dataset.delcustom; }));
          renderLevels(root);
        });
      });
    });
  }

  function openEditLevelModal(id) {
    var lv = LEVELS.filter(function (l) { return l.id === id; })[0];
    if (!lv) return;
    openModal(
      '<h3>Edit Level ' + pad(id) + '</h3><p class="sub">Renaming here only changes the display title. Original authored content is untouched.</p>' +
      '<div class="a-field"><label>Display title</label><input type="text" id="editTitle" value="' + esc(displayTitle(lv)) + '"></div>' +
      '<div class="a-modal__actions"><button class="a-btn" id="mCancel">Cancel</button><button class="a-btn primary" id="mSave">Save</button></div>'
    );
    $("#mCancel").addEventListener("click", closeModal);
    $("#mSave").addEventListener("click", function () {
      var v = $("#editTitle").value.trim();
      if (v && v !== lv.title) setLevelOverride(id, { title: v }); else clearLevelOverride(id);
      closeModal(); renderLevels($("#tabBody"));
    });
  }

  function openAddLevelModal() {
    openModal(
      '<h3>Add Level (catalog entry)</h3>' +
      '<p class="sub">Full case authoring (evidence, graded answer key, anti-cheat separation) happens through <code>build.py</code> from the authored source JSON, so a new fully-playable level can\u2019t be safely generated from inside the browser. This adds a supplementary catalog entry admins can plan and track here until it is authored through the normal pipeline.</p>' +
      '<div class="a-field"><label>Title</label><input type="text" id="newTitle" placeholder="e.g. Cloud Storage Misconfiguration"></div>' +
      '<div class="a-field"><label>Domain / tier note</label><input type="text" id="newDomain" placeholder="e.g. Cloud Security \u00b7 Intermediate"></div>' +
      '<div class="a-modal__actions"><button class="a-btn" id="mCancel">Cancel</button><button class="a-btn primary" id="mAdd">Add</button></div>'
    );
    $("#mCancel").addEventListener("click", closeModal);
    $("#mAdd").addEventListener("click", function () {
      var title = $("#newTitle").value.trim();
      if (!title) return;
      var list = customLevels();
      list.push({ id: "custom-" + Date.now(), title: title, domain: $("#newDomain").value.trim(), addedAt: Date.now() });
      saveCustomLevels(list);
      closeModal(); renderLevels($("#tabBody"));
    });
  }

  /* ============================ Section Management ============================ */
  function renderSections(root) {
    var f = sectionFlags();
    root.innerHTML =
      '<div class="a-note">Theory, Knowledge Test and Guided Investigation can be turned off as optional teaching aids - doing so auto-passes that gate so students go straight to the Real Investigation. Real Investigation and Assessment are the graded core of the platform and stay on. Disabling Book / About / AI Assistant hides that section\u2019s entry point site-wide.</div>' +
      '<div class="a-card">' +
      SECTION_DEFS.map(function (s) {
        return '<div class="a-toggle"><div class="a-toggle__label"><strong>' + esc(s.label) + (s.core ? ' <span class="a-pill">core</span>' : "") + '</strong><span>' + esc(s.desc) + '</span></div>' +
          '<label class="switch"><input type="checkbox" data-sec="' + s.key + '" ' + (f[s.key] ? "checked" : "") + (s.core ? " disabled" : "") + '><span class="track"><span class="thumb"></span></span></label></div>';
      }).join("") + '</div>';

    $$("[data-sec]", root).forEach(function (cb) {
      cb.addEventListener("change", function () {
        var key = cb.dataset.sec, def = SECTION_DEFS.filter(function (s) { return s.key === key; })[0];
        if (!cb.checked) {
          cb.checked = true; // hold the toggle visually until the admin confirms
          confirmDialog("Disable " + def.label + "?", "This turns it off across the whole platform immediately.", "Disable", true, function () {
            setSectionFlag(key, false);
            renderSections(root);
          });
        } else {
          setSectionFlag(key, true);
          renderSections(root);
        }
      });
    });
  }

  /* ============================ SOC Analyst Book ============================ */
  var bookSearchTerm = "", bookOpenId = (BOOK[0] || {}).id;
  function renderBook(root) {
    root.innerHTML =
      '<input class="a-field" style="max-width:320px" type="text" id="bookSearch" placeholder="Search chapters\u2026" value="' + esc(bookSearchTerm) + '">' +
      '<div class="a-book" style="margin-top:.9rem">' +
      '<div class="a-book__list" id="bookList"></div>' +
      '<div class="a-book__reader" id="bookReader"></div>' +
      '</div>';
    $("#bookSearch").addEventListener("input", function () { bookSearchTerm = this.value; paintBookList(); });
    paintBookList();
    paintBookReader();

    function paintBookList() {
      var term = bookSearchTerm.toLowerCase();
      var list = BOOK.filter(function (c) {
        if (!term) return true;
        return (c.title || "").toLowerCase().indexOf(term) !== -1 || (c.body || "").toLowerCase().indexOf(term) !== -1;
      });
      $("#bookList").innerHTML = list.length ? list.map(function (c) {
        return '<button data-ch="' + c.id + '" class="' + (c.id === bookOpenId ? "active" : "") + '">Ch. ' + pad(c.id) + ' \u2014 ' + esc(c.title) + '</button>';
      }).join("") : '<div class="a-empty" style="padding:.8rem">No chapters match your search.</div>';
      $$("[data-ch]", root).forEach(function (b) {
        b.addEventListener("click", function () { bookOpenId = +b.dataset.ch; paintBookList(); paintBookReader(); });
      });
    }
    function paintBookReader() {
      var c = BOOK.filter(function (x) { return x.id === bookOpenId; })[0];
      if (!c) { $("#bookReader").innerHTML = '<div class="a-empty">Select a chapter.</div>'; return; }
      $("#bookReader").innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem">' +
        '<span class="a-pill">Chapter ' + pad(c.id) + ' / ' + BOOK.length + '</span>' +
        '<div class="a-row"><button class="a-btn" id="bookPrev" ' + (c.id <= 1 ? "disabled" : "") + '>&larr; Previous</button>' +
        '<button class="a-btn" id="bookNext" ' + (c.id >= BOOK.length ? "disabled" : "") + '>Next &rarr;</button></div></div>' +
        '<h2 style="margin-top:0">' + esc(c.title) + '</h2>' +
        (c.body ? '<p>' + esc(c.body) + '</p>' : "") +
        (c.summary ? '<p style="color:var(--muted)"><strong>Summary:</strong> ' + esc(c.summary) + '</p>' : "");
      var prev = $("#bookPrev"), next = $("#bookNext");
      if (prev) prev.addEventListener("click", function () { bookOpenId = c.id - 1; paintBookList(); paintBookReader(); });
      if (next) next.addEventListener("click", function () { bookOpenId = c.id + 1; paintBookList(); paintBookReader(); });
    }
  }

  /* ============================ Theme Manager ============================ */
  function renderTheme(root) {
    root.innerHTML =
      '<div class="a-note">Changes apply across the entire website (student view, About page, and this panel) immediately, and persist in this browser via <code>localStorage</code>.</div>' +
      '<div class="theme-grid" id="themeGrid"></div>';
    window.SOCTheme.renderPicker($("#themeGrid"));
  }

  /* ============================ User / Progress Data ============================ */
  function renderProgress(root) {
    var state = readJSON(K_APP_STATE, null);
    var name = (localStorage.getItem(K_ANALYST_NAME) || "").trim();
    if (!state) {
      root.innerHTML = '<div class="a-card"><p class="a-empty">No student progress recorded in this browser yet. Progress is stored per-browser under <code>localStorage["soc_ops_state_v2"]</code>, the same way the main platform stores it.</p></div>';
      return;
    }
    var completedIds = Object.keys(state.completed || {}).map(Number).sort(function (a, b) { return a - b; });
    var scores = completedIds.map(function (id) { return state.completed[id].pct; });
    var avg = scores.length ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length) : 0;
    var hintsUsed = (state.hints && state.hints.used) ? state.hints.used.length : 0;

    root.innerHTML =
      '<div class="a-grid a-cols-4" style="margin-bottom:1.2rem">' +
      kpi(completedIds.length + "/30", "Levels closed") +
      kpi(avg + "%", "Average score") +
      kpi(hintsUsed, "Hints revealed (lifetime)") +
      kpi(state.book && state.book.unlockedOverride ? "UNLOCKED" : (completedIds.length >= 30 ? "UNLOCKED" : "LOCKED"), "Book status") +
      '</div>' +
      '<div class="a-card"><h3 style="margin-top:0">Analyst on record</h3>' +
      '<p style="color:var(--muted)">' + (name ? esc(name) : "No name captured yet \u2014 shown after the first completion popup.") + '</p></div>' +
      '<div class="a-card" style="margin-top:1rem"><h3 style="margin-top:0">Closed levels</h3>' +
      (completedIds.length ? '<table class="a-table"><thead><tr><th>Level</th><th>Title</th><th>Score</th><th>Decision</th></tr></thead><tbody>' +
        completedIds.map(function (id) {
          var lv = LEVELS.filter(function (l) { return l.id === id; })[0];
          var rec = state.completed[id];
          return '<tr><td>' + pad(id) + '</td><td>' + esc(lv ? lv.title : "") + '</td><td>' + rec.pct + '%</td><td>' + esc(rec.decision || "\u2014") + '</td></tr>';
        }).join("") + '</tbody></table>' : '<p class="a-empty">No levels closed yet.</p>') +
      '</div>' +
      '<p class="small" style="color:var(--muted);margin-top:1rem">This view is read-only. To export or reset a student\u2019s browser progress, use <strong>Cases &amp; Tools</strong> on the main platform (<code>#/tools</code>) - that keeps export/reset logic in one place.</p>';
  }

  /* ============================ Site Settings ============================ */
  function renderSettings(root) {
    root.innerHTML =
      '<div class="a-card" style="margin-bottom:1rem"><h3 style="margin-top:0">Change admin credentials</h3>' +
      '<p class="sub" style="color:var(--muted);font-size:.85rem;margin-top:-.4rem">Stored hashed in this browser\u2019s <code>localStorage</code> - a local convenience, not a server-verified account.</p>' +
      '<div class="a-field"><label>New username</label><input type="text" id="newUser" placeholder="admin"></div>' +
      '<div class="a-field"><label>New password</label><input type="password" id="newPass" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022"></div>' +
      '<button class="a-btn primary" id="saveCreds">Save credentials</button>' +
      '<span id="credsMsg" style="margin-left:.6rem;font-size:.82rem;color:var(--ok,#2c6b4f)"></span></div>' +

      '<div class="a-card" style="margin-bottom:1rem"><h3 style="margin-top:0">Platform info</h3>' +
      '<div class="a-grid a-cols-2">' +
      '<div><span style="color:var(--muted);font-size:.82rem">Authored levels</span><div style="font-weight:700">' + LEVELS.length + '</div></div>' +
      '<div><span style="color:var(--muted);font-size:.82rem">Book chapters</span><div style="font-weight:700">' + BOOK.length + '</div></div>' +
      '</div></div>' +

      '<div class="a-card"><h3 style="margin-top:0">Reset admin overrides</h3>' +
      '<p class="sub" style="color:var(--muted);font-size:.85rem">Clears level enable/disable overrides, display-title renames, custom catalog entries and section toggles. Does not touch student progress or the theme.</p>' +
      '<button class="a-btn danger" id="resetOverrides">Reset all admin overrides</button></div>';

    $("#saveCreds").addEventListener("click", function () {
      var u = $("#newUser").value.trim(), p = $("#newPass").value;
      if (!u || !p) { $("#credsMsg").style.color = "var(--bad,#c0392b)"; $("#credsMsg").textContent = "Enter both fields."; return; }
      setCredentials(u, p);
      $("#credsMsg").style.color = "var(--ok,#2c6b4f)";
      $("#credsMsg").textContent = "Saved. Use the new credentials next time you sign in.";
      $("#newUser").value = ""; $("#newPass").value = "";
    });
    $("#resetOverrides").addEventListener("click", function () {
      confirmDialog("Reset all admin overrides?", "This clears level enable/disable state, renames, custom catalog entries and section toggles in this browser.", "Reset", true, function () {
        localStorage.removeItem(K_LEVEL_OVERRIDES);
        localStorage.removeItem(K_SECTIONS);
        localStorage.removeItem(K_CUSTOM_LEVELS);
        renderTab("settings");
      });
    });
  }

  /* ============================ boot ============================ */
  if (isAuthed()) showShell();
})();
