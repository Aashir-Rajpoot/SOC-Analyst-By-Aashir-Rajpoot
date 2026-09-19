# SOC Operations Training Platform

A practical, defensive-only training environment for SOC analysts. Thirty sequential
investigations built on realistic (fictional) enterprise telemetry, a master multi-stage
assessment with a full incident report, and a thirty-chapter analyst book unlocked only
after every case is closed.

Everything runs in the browser. There is no server, no account, no network call, and no
command is ever executed against your machine.

---

## Run it

**Option 1 - open directly**

Extract the folder and double-click `index.html`. Works from `file://`.

**Option 2 - local web server (recommended)**

```
cd soc-training-platform
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

A server is recommended because the admin passcode uses the browser's SubtleCrypto API,
which browsers only expose on `http(s)://`. On `file://` the platform falls back to a
non-cryptographic hash automatically - fine for a local training install, weaker than the
server path.

**Rebuild the data bundles** (only needed if you edit anything in `data/`):

```
python3 build.py
```

---

## Structure

Everything is a **flat, single folder** - there are no `css/`, `js/` or `data/`
subfolders. Every file sits directly beside `index.html`:

```
index.html                application shell
soc.css, brand.css        enterprise console styling, responsive + print
app.js                    all application logic (state, routing, grading, tools, admin,
                           theory/quiz/guided training flow)
levels.js                 generated - public level payload, answer keys removed
eval.js                   generated - encoded evaluation payload (keys, hints, reviews, quiz answers)
book.js                   generated - 30 book chapters
soc-book.html             SOC Analyst By Aashir Rajpoot field guide: English + Roman Urdu editions,
                          reader, search and built-in PDF generator (single self-contained file).
                          Opens only when 30/30 levels are done, the admin grants access, or an admin
                          opens it from the Admin Panel > Book tab. PDF is generated in the browser.
commands.js               generated - 45-entry command reference
levels_a..d.json          authored levels 1-29 (each may include chapters / quizBank / guided)
levels_master.json        authored level 30 (master assessment)
book_a..c.json             authored book chapters 1-30
commands.json             authored command reference
build.py                  splits authored JSON into the public + encoded bundles
favicon.png, logo.png, logo.webp, intro.js   branding assets
```

## How the training works

Every level now runs a full training flow: **Theory -> Knowledge Test -> Guided
Investigation -> Real Investigation -> Assessment**, gated in that order.

1. **Theory (chapters).** Beginner-friendly, chapter-by-chapter theory (primarily Roman
   Urdu, with English cybersecurity terminology kept where natural): the concept, why a SOC
   cares, what it looks like in the data, common false positives, and investigation tips.
   Every chapter must be marked "learned" before the Knowledge Test unlocks.
2. **Knowledge Test.** 10 random multiple-choice questions drawn from a topic question
   bank. **Exactly 100% is required to pass** - 9/10 or lower fails and the test can be
   retried with a freshly randomized question set. Passing unlocks the Guided
   Investigation.
3. **Guided Investigation.** A step-by-step, interactive walkthrough ("Search Evidence" /
   "Show Me" / reasoning-choice steps) that teaches the investigation workflow (ALERT ->
   VALIDATE -> IDENTIFY ASSET -> CHECK EVIDENCE -> CORRELATE -> CHANGE CALENDAR -> TP/FP ->
   ESCALATION -> DOCUMENT) using a scenario. Completing it unlocks the Real Investigation.
4. **Real Investigation.** The original workspace: evidence with search and highlighting, a
   simulated read-only analyst terminal, the investigation task, analyst notes, a timeline
   builder, findings, decision (True Positive / False Positive / Needs Escalation),
   severity and recommendation. No answers are shown before submission.
5. **Assessment.** Scored feedback per item, a skill breakdown (Alert Triage, Evidence
   Analysis, Risk Assessment, Escalation, Documentation), the analyst review, time on case,
   evidence quality, then the next-task handover. On a fail: Review Theory / Repeat Guided
   Investigation / Retry Real Investigation.

**Level 4 (Authentication Analysis / "Multiple Failed Logins")** is the fully redesigned
flagship case for this flow: 12 hand-written Roman Urdu theory chapters, a 20-question MCQ
bank, and a guided investigation built on a *different* simulated failed-login scenario than
the real investigation, exactly as intended for a first fully-authored case.

**Every other level** already has rich existing theory content (concept / why / look /
false-positives / tips) and a working question bank, so the engine automatically builds
working chapters, a knowledge-test gate and a teaching guided-walkthrough from that existing
data - nothing is locked out, but only Level 4 currently has bespoke Roman Urdu chapters, a
large randomized MCQ bank and a custom guided scenario. The data model
(`chapters` / `quizBank` / `guided` fields on a level) is ready for any other level to be
upgraded the same way without touching the engine.

Pass mark for the Real Investigation is **70%**. Level N unlocks only when level N-1 is
closed at or above the pass mark. Levels 3, 9 and 16 are deliberate false positives; closing
them as incidents fails.

**Hints: two per rolling 24 hours**, enforced on stored timestamps across the whole
platform, so refreshing, reopening or using a new tab does not reset them. Hints point at
the right evidence; they never contain an answer.

**Level 30** is a ten-phase intrusion by a second actor, with 32 questions, an eleven-event
timeline and the full seventeen-section MASTER SOC REPORT. Completing it awards MASTER SOC
ANALYST and unlocks the book.

## Command reference

Press **CTRL + SHIFT + C then D**, or use the *Commands* button (bottom right, also the
mobile route). ESC closes it. Linux, Windows, network and investigation entries, each with
what it does, why a SOC uses it, an example, flags and a use case, with search, category
filters and copy-to-clipboard. It is reference material only - nothing executes.

## Administration

Footer link *Platform administration* (`#/admin`). There is no default or built-in
passcode: the first person to open the page sets one, and only its hash is stored, in this
browser. It provides a dashboard, system status, book chapter editing with revert, a
temporary book-access grant for review, level/case statistics, hint-window clearing and
per-level open/close control.

## Data and privacy

All progress, notes, reports, hint usage and admin settings live in `localStorage` under
`soc_ops_state_v2`, in your browser only. *Cases & Tools* exports it as JSON or resets it.

## Anti-cheating

`js/levels.js` contains no `accept`, `decision`, `severity_answer`, `recommend`,
`timelineKey`, `review` or `hints` field. Those are built by `build.py` into `js/eval.js`
as a single encoded blob decoded at grading time, so no answer key sits beside the
questions in page source. Nothing is unlocked by default, locked levels render no case
content, and locked book chapters render no chapter body even by direct URL.

## Known limitations

- Encoding the evaluation payload keeps answers out of casual view; it is obfuscation, not
  security. Anyone determined can decode client-side data. This is a training tool, not an
  exam invigilator.
- Progress is per browser and per device. Clearing site data removes it. Use the JSON
  export to keep a copy.
- Free-text answers are graded on accepted phrasings and keyword equivalence, so an unusual
  but correct wording can score as partial. The scored feedback always shows what was
  expected.
- The terminal is a simulation over the current case's evidence and supports a fixed set of
  read-only commands (`ls`, `cat`, `head`, `tail`, `grep`, `wc`, `whoami`, `id`, `hostname`,
  `date`, `clear`, `help`) with pipes. It never touches your filesystem.
- The SIEM, EDR, DNS and threat-intel views are static realistic datasets, not live feeds.
  Nothing in the platform claims to be real-time.
- Copy-to-clipboard in the command palette needs a secure context in some browsers; where
  it is blocked, the example text can be selected manually.
- On `file://` the admin passcode uses a non-cryptographic fallback hash.
- All hosts, users, addresses, domains, malware names, actors and incidents are fictional.
  The content teaches investigation and defence; it contains no working offensive tooling.
