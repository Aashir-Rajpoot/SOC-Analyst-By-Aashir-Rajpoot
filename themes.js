/* SOC Analyst Training Platform - Theme Engine
   Additive, standalone file. Defines 20+ professional themes as CSS custom
   property sets, applies them site-wide (index.html, about.html, admin.html)
   and persists the chosen theme in localStorage. Nothing here overrides
   soc.css/brand.css rules directly - it only sets the CSS variables those
   files already read (--ink, --accent, --panel, etc.) plus a few new ones
   (--accent-2, --glow, --gradient) that extras.css and the theme picker use.
   Include this file BEFORE app.js / admin.js so the saved theme paints
   before first render (no flash of default colors). */
(function (global) {
  "use strict";

  var STORE_KEY = "soc_theme_v1";

  /* Each theme sets the platform's existing variables (ink, ink-2, muted,
     line, line-soft, paper, surface, panel, accent, accent-soft) plus new
     ones: accent-2 (secondary), glow, and a ready-made gradient string. */
  var THEMES = [
    { id: "cyber-blue", name: "Cyber Blue", dark: false, vars: {
      ink:"#0f1e2e", "ink-2":"#1c3247", muted:"#5b7286", line:"#c9dbea", "line-soft":"#e3edf6",
      paper:"#f2f7fb", surface:"#ffffff", panel:"#e7f1f9", accent:"#1465c0", "accent-soft":"#dcebfa",
      "accent-2":"#00b4d8", glow:"rgba(20,101,192,.35)" } },

    { id: "neon-purple", name: "Neon Purple", dark: true, vars: {
      ink:"#efe9ff", "ink-2":"#cdbdf5", muted:"#9a8ac2", line:"#3a2e5c", "line-soft":"#2a2148",
      paper:"#160f28", surface:"#1d1638", panel:"#241c42", accent:"#9d4bff", "accent-soft":"#2e2050",
      "accent-2":"#ff4bd8", glow:"rgba(157,75,255,.45)" } },

    { id: "electric-cyan", name: "Electric Cyan", dark: true, vars: {
      ink:"#e4feff", "ink-2":"#b6ecef", muted:"#7fa6ab", line:"#12414a", "line-soft":"#0e3138",
      paper:"#061a1e", surface:"#0a2329", panel:"#0d2c33", accent:"#13e3f0", "accent-soft":"#0c3a41",
      "accent-2":"#3bf29a", glow:"rgba(19,227,240,.4)" } },

    { id: "midnight", name: "Midnight", dark: true, vars: {
      ink:"#e7ebf5", "ink-2":"#bfc8de", muted:"#7a86a3", line:"#232c47", "line-soft":"#1a2138",
      paper:"#0a0e1c", surface:"#111731", panel:"#161d3a", accent:"#5a72ff", "accent-soft":"#1c2550",
      "accent-2":"#7ee0ff", glow:"rgba(90,114,255,.4)" } },

    { id: "emerald-security", name: "Emerald Security", dark: false, vars: {
      ink:"#0d211a", "ink-2":"#1b3a2d", muted:"#547363", line:"#c4e2d2", "line-soft":"#e0f2e8",
      paper:"#f2f9f5", surface:"#ffffff", panel:"#e2f3ea", accent:"#0f8a56", "accent-soft":"#daf3e5",
      "accent-2":"#0ec8a0", glow:"rgba(15,138,86,.35)" } },

    { id: "crimson-soc", name: "Crimson SOC", dark: true, vars: {
      ink:"#fbe9e9", "ink-2":"#e9c3c3", muted:"#a97e7e", line:"#4a2020", "line-soft":"#3a1818",
      paper:"#1c0d0d", surface:"#251212", panel:"#2c1616", accent:"#e13b3b", "accent-soft":"#3a1616",
      "accent-2":"#ff8a3d", glow:"rgba(225,59,59,.4)" } },

    { id: "arctic", name: "Arctic", dark: false, vars: {
      ink:"#16232b", "ink-2":"#2c3e48", muted:"#647884", line:"#d7e6ec", "line-soft":"#eaf3f6",
      paper:"#f6fafc", surface:"#ffffff", panel:"#eaf5f8", accent:"#0d8fa8", "accent-soft":"#dcf1f5",
      "accent-2":"#5ac8e8", glow:"rgba(13,143,168,.3)" } },

    { id: "royal-violet", name: "Royal Violet", dark: true, vars: {
      ink:"#efe8fb", "ink-2":"#cebfe8", muted:"#8f7fae", line:"#3a2c56", "line-soft":"#2a2042",
      paper:"#160f26", surface:"#1e1638", panel:"#251c44", accent:"#7c3aed", "accent-soft":"#2c2048",
      "accent-2":"#c084fc", glow:"rgba(124,58,237,.4)" } },

    { id: "ocean", name: "Ocean", dark: false, vars: {
      ink:"#0c222e", "ink-2":"#1c3a4a", muted:"#5a7686", line:"#c5e0ea", "line-soft":"#e2f1f6",
      paper:"#f1f9fb", surface:"#ffffff", panel:"#e0f0f5", accent:"#0b6e99", "accent-soft":"#daeef5",
      "accent-2":"#20c9d6", glow:"rgba(11,110,153,.32)" } },

    { id: "matrix-green", name: "Matrix Green", dark: true, vars: {
      ink:"#d9ffe0", "ink-2":"#a9e8ba", muted:"#5f9270", line:"#123a1e", "line-soft":"#0d2c17",
      paper:"#050f08", surface:"#0a170d", panel:"#0e1f12", accent:"#22e35a", "accent-soft":"#0f2e17",
      "accent-2":"#8bff5a", glow:"rgba(34,227,90,.4)" } },

    { id: "sunset", name: "Sunset", dark: false, vars: {
      ink:"#2b1710", "ink-2":"#4a2c1c", muted:"#8a6350", line:"#f0d7c4", "line-soft":"#faeade",
      paper:"#fdf6f0", surface:"#ffffff", panel:"#fbe9dc", accent:"#e0632a", "accent-soft":"#fbe0cf",
      "accent-2":"#ffb84d", glow:"rgba(224,99,42,.32)" } },

    { id: "aurora", name: "Aurora", dark: true, vars: {
      ink:"#e6fbf5", "ink-2":"#b9e8dc", muted:"#6f9c93", line:"#173b39", "line-soft":"#102b2a",
      paper:"#071716", surface:"#0c211f", panel:"#102a27", accent:"#2ee6b8", "accent-soft":"#0f332e",
      "accent-2":"#9d6bff", glow:"rgba(46,230,184,.38)" } },

    { id: "titanium", name: "Titanium", dark: false, vars: {
      ink:"#20242a", "ink-2":"#3a3f47", muted:"#6c7178", line:"#d6d9de", "line-soft":"#eaecef",
      paper:"#f5f6f7", surface:"#ffffff", panel:"#e9ebee", accent:"#4b5563", "accent-soft":"#e3e6ea",
      "accent-2":"#7c8798", glow:"rgba(75,85,99,.28)" } },

    { id: "deep-space", name: "Deep Space", dark: true, vars: {
      ink:"#e9ecf7", "ink-2":"#c0c6e2", muted:"#767ea0", line:"#20264a", "line-soft":"#171c38",
      paper:"#070a18", surface:"#0d1128", panel:"#111633", accent:"#4361ee", "accent-soft":"#181e42",
      "accent-2":"#00d4ff", glow:"rgba(67,97,238,.42)" } },

    { id: "hacker-red", name: "Hacker Red", dark: true, vars: {
      ink:"#ffe9e9", "ink-2":"#f0bcbc", muted:"#a87373", line:"#421c1c", "line-soft":"#301313",
      paper:"#120707", surface:"#1a0c0c", panel:"#221010", accent:"#ff2d2d", "accent-soft":"#331313",
      "accent-2":"#ff9d2d", glow:"rgba(255,45,45,.45)" } },

    { id: "sapphire", name: "Sapphire", dark: false, vars: {
      ink:"#0e1c33", "ink-2":"#1e3358", muted:"#5a6f92", line:"#cbdaf0", "line-soft":"#e5edfa",
      paper:"#f3f6fc", surface:"#ffffff", panel:"#e4edfa", accent:"#1d4ed8", "accent-soft":"#dde8fb",
      "accent-2":"#38bdf8", glow:"rgba(29,78,216,.34)" } },

    { id: "magenta", name: "Magenta", dark: true, vars: {
      ink:"#ffe8f7", "ink-2":"#eabde0", muted:"#a877a0", line:"#421f3c", "line-soft":"#30162c",
      paper:"#160a15", surface:"#1e0f1c", panel:"#261324", accent:"#e620b0", "accent-soft":"#331730",
      "accent-2":"#ff6ec7", glow:"rgba(230,32,176,.42)" } },

    { id: "gold-cyber", name: "Gold Cyber", dark: true, vars: {
      ink:"#fdf4de", "ink-2":"#e9d6a6", muted:"#a3936a", line:"#3a301a", "line-soft":"#2b2313",
      paper:"#141008", surface:"#1c1710", panel:"#241d12", accent:"#e2a825", "accent-soft":"#332a15",
      "accent-2":"#ffd76a", glow:"rgba(226,168,37,.4)" } },

    { id: "ice-blue", name: "Ice Blue", dark: false, vars: {
      ink:"#0f2430", "ink-2":"#1f3f4f", muted:"#5c7a89", line:"#c8e6ef", "line-soft":"#e4f4f8",
      paper:"#f2fafc", surface:"#ffffff", panel:"#e1f3f8", accent:"#0aa3c2", "accent-soft":"#d8f1f7",
      "accent-2":"#7fe3ff", glow:"rgba(10,163,194,.3)" } },

    { id: "plasma", name: "Plasma", dark: true, vars: {
      ink:"#f5e9ff", "ink-2":"#d9b9f5", muted:"#9b7fb8", line:"#3c2258", "line-soft":"#2c1942",
      paper:"#130a20", surface:"#1b1030", panel:"#22143c", accent:"#b026ff", "accent-soft":"#2e1848",
      "accent-2":"#ff2ec4", glow:"rgba(176,38,255,.45)" } },

    { id: "steel-slate", name: "Steel Slate", dark: false, vars: {
      ink:"#1b2530", "ink-2":"#334152", muted:"#68798c", line:"#d4dde4", "line-soft":"#e9eef2",
      paper:"#f5f8fa", surface:"#ffffff", panel:"#e8eef2", accent:"#3b6e91", "accent-soft":"#dfeaf1",
      "accent-2":"#63c2c9", glow:"rgba(59,110,145,.3)" } },

    { id: "solar-flare", name: "Solar Flare", dark: true, vars: {
      ink:"#fff2e6", "ink-2":"#ffd3ab", muted:"#b98f6e", line:"#4a2c12", "line-soft":"#35200d",
      paper:"#180d04", surface:"#211307", panel:"#2b1809", accent:"#ff7a1a", "accent-soft":"#3a2210",
      "accent-2":"#ffd23f", glow:"rgba(255,122,26,.42)" } }
  ];

  var DEFAULT_ID = "cyber-blue";
  var VAR_MAP = ["ink","ink-2","muted","line","line-soft","paper","surface","panel","accent","accent-soft","accent-2","glow"];

  function byId(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
    return null;
  }

  function currentId() {
    try { return localStorage.getItem(STORE_KEY) || DEFAULT_ID; }
    catch (e) { return DEFAULT_ID; }
  }

  function apply(id) {
    var t = byId(id) || byId(DEFAULT_ID);
    var root = document.documentElement;
    VAR_MAP.forEach(function (k) {
      if (t.vars[k]) root.style.setProperty("--" + k, t.vars[k]);
    });
    root.style.setProperty("--gradient", "linear-gradient(135deg," + t.vars.accent + "," + t.vars["accent-2"] + ")");
    root.setAttribute("data-theme", t.id);
    root.setAttribute("data-theme-mode", t.dark ? "dark" : "light");
    try { localStorage.setItem(STORE_KEY, t.id); } catch (e) {}
    document.dispatchEvent(new CustomEvent("soc-theme-changed", { detail: { id: t.id } }));
    return t;
  }

  function init() { return apply(currentId()); }

  /* Renders the visual theme-picker grid used by the Admin Panel's Theme
     Manager into the given container element. Safe to call more than once. */
  function renderPicker(container) {
    if (!container) return;
    var active = currentId();
    container.innerHTML = THEMES.map(function (t) {
      var isActive = t.id === active;
      return (
        '<div class="theme-card' + (isActive ? " active" : "") + '" data-theme-id="' + t.id + '">' +
          '<div class="theme-card__swatch" style="background:linear-gradient(135deg,' + t.vars.accent + ',' + t.vars["accent-2"] + ')">' +
            '<span class="theme-card__dot" style="background:' + t.vars.surface + '"></span>' +
            '<span class="theme-card__dot" style="background:' + t.vars.panel + '"></span>' +
          '</div>' +
          '<div class="theme-card__meta">' +
            '<strong>' + t.name + '</strong>' +
            '<span class="theme-card__mode">' + (t.dark ? "Dark" : "Light") + '</span>' +
          '</div>' +
          '<button class="theme-card__btn" type="button">' + (isActive ? "Active" : "Select") + '</button>' +
          (isActive ? '<span class="theme-card__badge">ACTIVE</span>' : "") +
        '</div>'
      );
    }).join("");
    container.querySelectorAll(".theme-card").forEach(function (card) {
      card.querySelector(".theme-card__btn").addEventListener("click", function () {
        apply(card.getAttribute("data-theme-id"));
        renderPicker(container);
      });
    });
  }

  global.SOCTheme = {
    THEMES: THEMES,
    DEFAULT_ID: DEFAULT_ID,
    apply: apply,
    init: init,
    current: currentId,
    renderPicker: renderPicker
  };

  /* Auto-apply as early as possible. */
  init();
})(window);
