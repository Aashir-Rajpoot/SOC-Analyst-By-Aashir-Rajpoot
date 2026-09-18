/* Brand intro controller - no dependencies, runs once per page load.
   The animation itself is pure CSS; this only unlocks the page and
   removes the overlay so the platform is interactive immediately. */
(function () {
  "use strict";

  var DURATION = 2000; // ms - matches brand.css timeline

  function start() {
    var intro = document.getElementById("brandIntro");
    if (!intro) return;

    var reduced = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var root = document.documentElement;
    var done = false;

    function finish() {
      if (done) return;
      done = true;
      root.classList.remove("brand-intro-lock");
      if (intro.parentNode) intro.parentNode.removeChild(intro);
      window.removeEventListener("keydown", skip, true);
      window.removeEventListener("pointerdown", skip, true);
    }

    function skip() { finish(); }

    if (reduced) { finish(); return; }

    root.classList.add("brand-intro-lock");
    window.addEventListener("keydown", skip, true);
    window.addEventListener("pointerdown", skip, true);

    // safety net: never hold the page hostage
    setTimeout(finish, DURATION + 60);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
