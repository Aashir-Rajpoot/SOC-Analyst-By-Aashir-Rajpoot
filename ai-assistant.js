/* SOC Analyst Training Platform - Open AI Assistant (Feature 7)
   Floating "Ask AI" button available site-wide (NOT inside the admin panel -
   admin.html never includes this file). Opens a ChatGPT-style panel.

   SECURITY / ARCHITECTURE NOTE
   -----------------------------
   This platform is a static, serverless site (see README: "no server, no
   account, no network call"). Because a real AI provider key can never be
   safely embedded in public frontend JS, this widget is built as a clean
   two-layer client:
     1. It first tries POSTing to a configurable backend endpoint
        (CONFIG.endpoint, default "/api/chat"). If a real backend/proxy is
        deployed later (recommended: a small server that holds the actual
        provider key and forwards the request), this widget starts using it
        automatically - nothing else needs to change.
     2. If that call fails (404 / network error, as it will on plain static
        hosting), it falls back to a local, offline SOC/cybersecurity
        knowledge base so the assistant still works today, with no key of
        any kind in the client.
   The assistant never reveals graded answer keys (decision, severity,
   recommendation, hints, review) for any level - it only teaches concepts. */
(function (global) {
  "use strict";

  var CONFIG = {
    endpoint: "/api/chat",   // point this at a real backend proxy when one exists
    model: "soc-assistant"
  };

  var HISTORY_LIMIT = 40;
  var session = []; // {role:'user'|'assistant', text}

  /* ---------------- local knowledge base (fallback, no network) ---------------- */
  var KB = [
    { k: ["soc", "security operations center", "security operations centre"], a:
      "A SOC (Security Operations Centre) is the team and toolset that monitors an organisation's systems around the clock, triages alerts, investigates suspicious activity, and coordinates the response to confirmed incidents. Analysts typically work in tiers: Tier 1 triages alerts, Tier 2 investigates deeper, Tier 3 / IR handles confirmed incidents and threat hunting." },
    { k: ["siem"], a:
      "A SIEM (Security Information and Event Management) system collects logs from endpoints, servers, network devices and cloud services, normalises them, and correlates events so analysts can search across the whole environment from one place and get alerted on suspicious patterns (e.g. many failed logins followed by a success)." },
    { k: ["log", "logs", "logging"], a:
      "Logs are timestamped records of activity - a login attempt, a process starting, a firewall decision, a DNS query. Good log analysis means knowing what 'normal' looks like for a given source so anomalies (unusual time, unusual location, unusual volume) stand out. Always note the source, timestamp, and correlate multiple logs before drawing a conclusion." },
    { k: ["incident response", "ir process", "incident handling"], a:
      "A common Incident Response flow: Preparation, Identification, Containment, Eradication, Recovery, and Lessons Learned. In practice as an analyst you'll mostly live in Identification (triage/investigate) and help feed Containment decisions - isolate the host, disable the account, block the indicator - to the response team." },
    { k: ["threat detection", "detect threats", "detection"], a:
      "Threat detection combines signature-based rules (known bad hashes, IPs, patterns), behavioural analytics (unusual process trees, impossible travel logins), and threat intelligence (indicators shared by the community). As an analyst, always validate an alert against real evidence before deciding True Positive / False Positive." },
    { k: ["authentication", "failed login", "brute force", "credential"], a:
      "Authentication analysis looks at login telemetry: source IP/geo, account, time, success/failure, and MFA status. Multiple failed logins followed by a success from a new location is a classic brute-force / credential-stuffing pattern worth escalating. Always check whether MFA was satisfied and whether the account's normal behaviour matches." },
    { k: ["malware"], a:
      "Malware is software designed to harm, spy on, or gain unauthorised access to a system - ransomware, trojans, worms, spyware, etc. Analysts look for indicators like unexpected process creation, persistence mechanisms (registry run keys, scheduled tasks), outbound beaconing, or a known-bad file hash matching threat intel." },
    { k: ["phishing"], a:
      "Phishing uses deceptive email/messages to trick users into revealing credentials or running malicious content. Look for spoofed sender domains, urgency language, mismatched links, and unusual attachment types. A confirmed phishing click often needs credential reset + endpoint check as follow-up actions." },
    { k: ["network", "networking"], a:
      "Core networking concepts that matter for a SOC analyst: IP addressing, DNS resolution, TCP/UDP ports and common services, NAT, and how firewalls/proxies log allow/deny decisions. Understanding normal traffic flow makes it much easier to spot beaconing, data exfiltration, or scanning activity." },
    { k: ["true positive", "false positive", "tp", "fp", "escalation"], a:
      "A True Positive is a confirmed real security issue; a False Positive is an alert that looked suspicious but has a legitimate explanation once investigated (e.g. an admin's known maintenance window). Needs Escalation is used when evidence is genuinely inconclusive and a senior analyst or IR team should review it. The decision should always follow from the evidence you gathered, not a guess." },
    { k: ["mitre", "att&ck", "attack framework"], a:
      "MITRE ATT&CK is a knowledge base of real-world adversary tactics and techniques (e.g. Initial Access, Persistence, Privilege Escalation, Exfiltration). SOC teams map detections and incidents to ATT&CK technique IDs so coverage gaps and attacker behaviour are easier to track and communicate." },
    { k: ["dns"], a:
      "DNS (Domain Name System) translates domain names to IP addresses. In investigations, DNS logs are useful for spotting beaconing to newly-registered or algorithmically-generated domains (DGA), typosquatted lookalike domains, or DNS tunnelling used for covert exfiltration." },
    { k: ["hint", "hints"], a:
      "Hints on this platform point you toward the right piece of evidence to look at - they never give you the final answer. You get 2 hints per rolling 24 hours across the whole platform, so use them on the case you're most stuck on." },
    { k: ["level", "investigation", "case"], a:
      "Each level runs Theory \u2192 Knowledge Test \u2192 Guided Investigation \u2192 Real Investigation \u2192 Assessment. Read the theory chapters fully, pass the knowledge test at 100%, walk through the guided scenario to learn the workflow, then apply the same reasoning independently in the real investigation. I can help explain concepts from any of these stages, but I won't reveal the graded decision, severity, or recommendation for a specific case - that's for you to work out from the evidence." },
    { k: ["assessment", "grading", "score", "pass mark"], a:
      "The Real Investigation is graded against the evidence, your decision/severity/recommendation, and your report sections; 70% is the pass mark for a level. The Assessment view then shows scored feedback per item plus a skill breakdown (Alert Triage, Evidence Analysis, Risk Assessment, Escalation, Documentation) so you know exactly where to improve." },
    { k: ["hello", "hi", "salam", "assalam"], a:
      "Hey! I'm the training assistant for this SOC platform. Ask me about SOC concepts, SIEM, logs, incident response, threat detection, authentication analysis, malware, phishing, networking, or how a specific stage (Theory / Knowledge Test / Guided or Real Investigation / Assessment) works." }
  ];

  var REFUSAL_PATTERNS = [
    /what('?s| is) the (correct )?(answer|decision|severity|recommendation)/i,
    /give me the (answer|key|hint|solution)/i,
    /is (it|this) (true positive|false positive|needs escalation)/i,
    /answer key/i
  ];

  function localAnswer(q) {
    var text = q.toLowerCase();
    for (var i = 0; i < REFUSAL_PATTERNS.length; i++) {
      if (REFUSAL_PATTERNS[i].test(text)) {
        return "I can't hand over the graded decision, severity, or answer key for a level - that would defeat the training. What I can do is help you reason through the evidence: tell me what you've found so far (timestamps, source IPs, accounts involved) and I'll help you think about what it points to.";
      }
    }
    var best = null, bestScore = 0;
    KB.forEach(function (entry) {
      var score = 0;
      entry.k.forEach(function (kw) { if (text.indexOf(kw) !== -1) score += kw.length; });
      if (score > bestScore) { bestScore = score; best = entry; }
    });
    if (best) return best.a;
    return "I don't have a canned answer for that exact question, but I can help with SOC, cybersecurity, networking, SIEM, logs, incident response, threat detection, authentication, malware, phishing, or how the training levels work. Try rephrasing, or ask about one of those topics.";
  }

  /* ---------------- backend attempt, then local fallback ---------------- */
  function askBackend(question, history) {
    return fetch(CONFIG.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: CONFIG.model, message: question, history: history.slice(-10) })
    }).then(function (r) {
      if (!r.ok) throw new Error("no backend");
      return r.json();
    }).then(function (data) {
      if (data && typeof data.reply === "string") return data.reply;
      throw new Error("bad backend shape");
    });
  }

  function ask(question) {
    return askBackend(question, session).catch(function () {
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(localAnswer(question)); }, 380 + Math.random() * 380);
      });
    });
  }

  /* ---------------- UI ---------------- */
  var fab, panel, body, input, sendBtn;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function addMsg(role, text) {
    var m = el("div", "ai-msg " + (role === "user" ? "user" : "bot"), escapeHtml(text));
    body.appendChild(m);
    body.scrollTop = body.scrollHeight;
    return m;
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function buildUI() {
    fab = el("button", "ai-fab", '<span class="ai-fab__dot"></span><span class="ai-fab__label">Ask AI</span>');
    fab.setAttribute("aria-label", "Open AI Assistant");
    fab.setAttribute("type", "button");

    panel = el("div", "ai-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "AI Assistant chat");
    panel.innerHTML =
      '<div class="ai-panel__head"><div><h4>SOC Training Assistant</h4><span>Ask about SOC, SIEM, IR, networking & more</span></div>' +
      '<div class="ai-panel__headbtns"><button type="button" data-clear title="Clear chat">\u21BB</button>' +
      '<button type="button" data-close title="Close">\u2715</button></div></div>' +
      '<div class="ai-panel__body" id="aiBody"></div>' +
      '<div class="ai-quick" id="aiQuick"></div>' +
      '<div class="ai-panel__foot"><textarea id="aiInput" rows="1" placeholder="Ask a question... (Enter to send)"></textarea>' +
      '<button type="button" id="aiSend">Send</button></div>';

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    body = panel.querySelector("#aiBody");
    input = panel.querySelector("#aiInput");
    sendBtn = panel.querySelector("#aiSend");

    var quick = panel.querySelector("#aiQuick");
    ["What is a SIEM?", "Explain phishing", "How does grading work?", "MITRE ATT&CK?"].forEach(function (q) {
      var b = el("button", "", escapeHtml(q));
      b.type = "button";
      b.addEventListener("click", function () { input.value = q; send(); });
      quick.appendChild(b);
    });

    fab.addEventListener("click", openPanel);
    panel.querySelector("[data-close]").addEventListener("click", closePanel);
    panel.querySelector("[data-clear]").addEventListener("click", function () {
      session = []; body.innerHTML = "";
      addMsg("assistant", "Chat cleared. Ask me anything about SOC, cybersecurity, networking or this training platform.");
    });
    sendBtn.addEventListener("click", send);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    input.addEventListener("input", function () {
      input.style.height = "auto";
      input.style.height = Math.min(90, input.scrollHeight) + "px";
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panel.classList.contains("open")) closePanel();
    });

    addMsg("assistant", "Hey! I'm the training assistant for this SOC platform. Ask me about SOC concepts, SIEM, logs, incident response, threat detection, or how the levels work.");
  }

  function openPanel() {
    panel.classList.add("open");
    setTimeout(function () { input.focus(); }, 120);
  }
  function closePanel() { panel.classList.remove("open"); }

  function send() {
    var q = (input.value || "").trim();
    if (!q) return;
    input.value = ""; input.style.height = "auto";
    addMsg("user", q);
    session.push({ role: "user", text: q });
    if (session.length > HISTORY_LIMIT) session = session.slice(-HISTORY_LIMIT);

    var typing = addMsg("assistant", "Thinking...");
    typing.classList.add("typing");
    sendBtn.disabled = true;

    ask(q).then(function (reply) {
      typing.remove();
      addMsg("assistant", reply);
      session.push({ role: "assistant", text: reply });
      sendBtn.disabled = false;
    }).catch(function () {
      typing.remove();
      addMsg("assistant", "Something went wrong reaching the assistant. Please try again.");
      sendBtn.disabled = false;
    });
  }

  function init() {
    if (document.body.getAttribute("data-ai-assistant") === "off") return;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", buildUI);
    } else {
      buildUI();
    }
  }

  global.SOCAssistant = { init: init, ask: ask, CONFIG: CONFIG };
  init();
})(window);
