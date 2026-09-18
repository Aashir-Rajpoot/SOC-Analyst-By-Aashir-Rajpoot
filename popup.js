/* SOC Analyst Training Platform - Completion Popup System
   Feature 6: on a meaningful completed task (theory, knowledge test, guided
   investigation, real investigation / assessment, level completion) shows a
   professional "Enter Your Name" popup the first time, then a motivational
   popup. On later completions it shows a lighter achievement toast using
   the saved name instead of asking again. Standalone file - app.js calls
   window.SOCPopup.trigger(eventType, levelId) at the right points; nothing
   here touches grading, state.completed or the anti-cheat data. */
(function (global) {
  "use strict";

  var NAME_KEY = "soc_analyst_name_v1";
  var SEEN_KEY = "soc_popup_seen_v1"; // which milestone types have already shown the full popup once

  var LABELS = {
    theory: "Theory",
    quiz: "Knowledge Test",
    guided: "Guided Investigation",
    investigation: "Real Investigation",
    assessment: "Assessment",
    level: "Level"
  };

  function getName() {
    try { return (localStorage.getItem(NAME_KEY) || "").trim(); } catch (e) { return ""; }
  }
  function setName(n) {
    try { localStorage.setItem(NAME_KEY, n.trim()); } catch (e) {}
  }
  function seenSet() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}"); } catch (e) { return {}; }
  }
  function markSeen(type) {
    var s = seenSet(); s[type] = true;
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  var MOTIVATIONAL = "Dost, Tum Kar Sakte Ho \u2764\uFE0F\nConsistency Ke Sath Karte Raho.\nMain Tumhara Sath Hoon.";

  function closeBackdrop(backdrop) {
    backdrop.classList.remove("show");
    setTimeout(function () { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }, 220);
  }

  function openBackdrop(cardHTML, opts) {
    opts = opts || {};
    var backdrop = el("div", "soc-popup-backdrop");
    var card = el("div", "soc-popup-card", cardHTML);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    requestAnimationFrame(function () { backdrop.classList.add("show"); });

    function onKey(e) {
      if (e.key === "Escape" && opts.allowEsc !== false) { closeBackdrop(backdrop); document.removeEventListener("keydown", onKey); }
    }
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop && opts.allowBackdropClose !== false) closeBackdrop(backdrop);
    });
    return { backdrop: backdrop, card: card, close: function () { closeBackdrop(backdrop); document.removeEventListener("keydown", onKey); } };
  }

  function showNamePopup(onDone) {
    var inst = openBackdrop(
      '<button class="soc-popup-close" data-x aria-label="Close">\u2715</button>' +
      '<div class="soc-popup-icon">\uD83D\uDC64</div>' +
      '<h3>Enter Your Name</h3>' +
      '<p>Great work finishing this step. What should we call you on this platform?</p>' +
      '<input type="text" id="socNameInput" placeholder="Your name" maxlength="40" autocomplete="off">' +
      '<div class="soc-popup-actions"><button class="grad-btn" data-continue>Continue</button></div>',
      { allowEsc: true, allowBackdropClose: false }
    );
    var input = inst.card.querySelector("#socNameInput");
    setTimeout(function () { input.focus(); }, 60);
    function submit() {
      var v = (input.value || "").trim();
      if (!v) { input.focus(); input.style.borderColor = "var(--bad,#c0392b)"; return; }
      setName(v);
      inst.close();
      onDone(v);
    }
    inst.card.querySelector("[data-continue]").addEventListener("click", submit);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
    inst.card.querySelector("[data-x]").addEventListener("click", function () { inst.close(); });
  }

  function showMotivationalPopup(name) {
    openBackdrop(
      '<button class="soc-popup-close" data-x aria-label="Close">\u2715</button>' +
      '<div class="soc-popup-icon">\u2764\uFE0F</div>' +
      '<h3>Great work' + (name ? ", " + escapeHtml(name) : "") + '!</h3>' +
      '<p>' + escapeHtml(MOTIVATIONAL) + '</p>' +
      '<div class="soc-popup-actions"><button class="grad-btn" data-continue>Keep Going</button></div>',
      { allowEsc: true }
    );
    document.querySelector(".soc-popup-backdrop:last-of-type [data-continue]");
    var backs = document.querySelectorAll(".soc-popup-backdrop");
    var last = backs[backs.length - 1];
    if (last) {
      last.querySelector("[data-continue]").addEventListener("click", function () { closeBackdrop(last); });
      last.querySelector("[data-x]").addEventListener("click", function () { closeBackdrop(last); });
    }
  }

  function showAchievementToast(label, name) {
    var t = el("div", "soc-ach",
      '<span class="soc-ach__icon">\u2705</span>' +
      '<span><strong>' + escapeHtml(label) + ' complete' + (name ? ", " + escapeHtml(name) : "") + '!</strong>' +
      '<span>Consistency ke sath karte raho \u2764\uFE0F</span></span>'
    );
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () {
      t.classList.remove("show");
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, 3200);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* Public entry point. type: theory | quiz | guided | investigation | assessment | level
     levelId is optional, used only to avoid duplicate popups for the exact
     same milestone if trigger() is accidentally called twice in a row. */
  var lastTrigger = "";
  function trigger(type, levelId) {
    var tag = type + ":" + (levelId || "");
    var now = Date.now();
    if (lastTrigger === tag && trigger._t && now - trigger._t < 800) return; // debounce double-fires
    lastTrigger = tag; trigger._t = now;

    var label = LABELS[type] || "Task";
    var name = getName();
    var seen = seenSet();

    if (!name && !seen.__name_captured) {
      showNamePopup(function (n) {
        seen.__name_captured = true;
        try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (e) {}
        showMotivationalPopup(n);
      });
      return;
    }
    if (!seen[type]) {
      markSeen(type);
      showMotivationalPopup(name);
      return;
    }
    showAchievementToast(label, name);
  }

  global.SOCPopup = { trigger: trigger, getName: getName, setName: setName };
})(window);
