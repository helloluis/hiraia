# Tala V1.0 — Product Requirements Document

**Product:** Tala, a free lesson-planning app for teachers, built around the Philippine DepEd curriculum (web + mobile)
**Production target:** `https://tala.hiraia.org`
**Launch target:** school year 2027–2028, usable and demonstrable from any day before then
**Status:** Draft 5, Luis's decisions, design direction and the final Tala teal (`#2F6360`) folded in · 13 November 2026. This is the working product spec.
**Owner:** Luis Buenaventura · **Author:** Claude Fable 5.2
**Release name:** "Tala V1.0" is applied only when every V1.0 gate in §16 has passed.

---

## How to read this document

- Requirements carry IDs (`PLAN-3`, `LLM-7`) and a priority: **P0** = required for V1.0, **P1** = should ship in V1.0 and can slip to V1.1 with Luis's sign-off, **P2** = after V1.0.
- Items marked **[verify]** are statements about DepEd policy or third-party products written from general knowledge and not checked against a current source. Each must be confirmed before it is built on.
- §18 lists the decisions in force: Luis's, and mine where the brief was silent. §19 lists the assumptions I made in applying Luis's answers, and what is still open.

---

## 1. Overview

Tala is a planning tool for one teacher at a time. A teacher signs in, sets up the classes they actually teach, and from then on the app opens on the lessons they are due to teach this week and this month, worked out from the DepEd curriculum and their own school calendar. They can write a lesson plan by hand, or have a language model draft one from the scheduled competencies, then edit it, lock it, download it as a PDF, and carry it on their phone with no signal. They can post plans to a shared community area, and copy and modify plans other teachers have posted.

Three things separate Tala from general-purpose planners:

1. **It knows the DepEd curriculum and the calendar.** The teacher does not start from a blank grid.
2. **Multi-grade classrooms are a first-class case.** A teacher with up to four grade levels in one room (for example Grade 2 and Grade 4 learners together) gets one coherent session plan, in the planner, the pacing engine and the generator alike.
3. **It works on a low-end Android phone with no connection**, which is the normal condition in the schools it is built for.

Tala is free and **open to any teacher**. It is designed first for Philippine public-school teachers and the DepEd curriculum, but nobody is asked to prove where or whether they teach. Hiraia is not-for-profit, so the running cost per teacher is a design constraint (§9.7).

Tala wears the **Hiraia brand** and is designed for teachers in last-mile schools who are not technical and who use entry-level or midrange phones. Every design choice leans to the simpler option, and bad connectivity, small screens and limited hardware are treated as the normal case, each with a fallback (§4.3).

A teacher can start on any day of the school year. The launch target is SY 2027–2028, and the app must be fully usable mid-year so it can be demonstrated during SY 2026–2027 (§7.5).

### 1.1 Tala V1.0 absorbs Hiraia Tala 0.4.x

The repository already ships **Hiraia Tala 0.4.x** (`packages/tala`, package `com.hiraia.tala`), a Kotlin Android teacher companion that collects student activity from the Hiraia student app over Nearby Connections. **Tala V1.0 absorbs it.** There is one Tala app: the planning product in this document, with the 0.4.x classroom-activity features carried into it as a pillar (§6.7).

Consequences:

- One Android package (`com.hiraia.tala`), upgraded in place over 0.4.x, signed with the established pilot key.
- The Kotlin app is retired once the new app reaches feature parity. Until then **0.4.x remains an independent, shippable release line** on `main`: fixes to it are never blocked by, or entangled with, V1.0 work, which lives only on the `tala-v1` branch in new packages.
- Until the cutover, V1.0 demo builds use a separate application id (`com.hiraia.tala.next`), signing key and no update channel, so they install beside 0.4.x. Taking over `com.hiraia.tala` with the pilot key (ACT-2) is one deliberate step at V1.0 release.
- Activity collection becomes a native module inside the Expo/React Native app (§13.5).
- A class is one thing: the class a teacher plans for is the class whose students join by QR.

---

## 2. Problem

Philippine public-school teachers prepare lesson plans every week in a prescribed shape (Daily Lesson Log or Detailed Lesson Plan **[verify]** current DepEd policy on which is required of whom). The work is repetitive and largely done in Word documents passed around on Facebook groups and USB drives.

- **The planning tools that exist are built for another school system.** Chalk/Planboard assumes US-style standards sets, reliable broadband, a laptop, and English. Aligning it to MATATAG competencies is manual work the teacher does alone.
- **Multi-grade teachers are served worst.** A teacher in a barrio school with two to four grade levels in one room has to reconcile separate curriculum guides into one session and manage what the other groups do while one is being taught. Generic planners and generic AI lesson generators both model one class as one grade.
- **Connectivity is intermittent and the device is a phone.** Many teachers plan on a budget Android phone, with mobile data they pay for themselves.
- **Shared plans are untraceable.** Downloaded plans arrive without a source, a version, a curriculum tag, or any signal of quality, and often with another school's student names still in them.
- **Setup cost kills adoption.** Entering a year's timetable and then tagging every lesson to a competency by hand is the point where teachers abandon a planner.

---

## 3. Target users

Anyone who teaches can sign up. The personas below are who Tala is designed and tested for.

| Persona | Situation | What they need from Tala |
|---|---|---|
| **Multi-grade teacher, remote/barrio school** (primary design target) | One room, two to four grade levels (e.g. Grades 2 and 4), often every subject. Phone only. Signal at the town proper or on a hill. Frequent class suspensions for weather. | A single plan for a mixed session; plans that are on the phone before leaving signal; pacing that recovers after lost days. |
| **Self-contained elementary teacher** | One section, all or most subjects, K–6. Shared or personal phone, sometimes a school laptop. | The week laid out across subjects; fast drafts; a PDF in the expected format. |
| **Subject teacher, junior/senior high** | One or two subjects across several sections, sometimes several grade levels. | Plan once, apply to several sections, and track each section's progress separately when they drift apart. |
| **New or out-of-field teacher** | Teaching a subject or grade they were not trained for. | Curriculum-grounded drafts and community plans to adapt. |
| **Contributor** | Experienced teacher whose plans are already copied informally. | Credit, lineage, and control over what is public. |
| **Pilot teacher already on Tala 0.4.x** | Uses Tala today to collect class activity from Hiraia student phones. | The same collection features after upgrading, with nothing lost and no re-enrolment. |
| **Any other teacher** | Private school, ALS, tutor, home educator, teacher outside the Philippines. | The same app. They get full planning, scheduling, generation and community features; preloaded curriculum and calendar presets exist only for DepEd (CUR-10). |

**No login in V1.0 for:** school heads, supervisors, division offices, students, parents. V1.0 has exactly one role: teacher. Tala does not verify that an account holder is a teacher.

---

## 4. Goals and non-goals

### 4.1 Goals

- **G1.** On sign-in, a teacher with a configured class sees the lessons due this week and this month without doing anything.
- **G2.** A teacher can produce a complete, curriculum-tagged, editable lesson plan for a single-grade or multi-grade session in under ten minutes, including review time.
- **G3.** Any plan can be locked as final and downloaded as a PDF a school head would accept.
- **G4.** Every plan the teacher needs in the coming weeks is readable and editable on their phone with no connection, without them asking for it.
- **G5.** Class setup, including the student list, takes minutes from whatever file or text the teacher already has.
- **G6.** Teachers can post, find, copy and modify plans with attribution and with no student data leaking.
- **G7.** Roughly 80–90% of the free-tier Planboard teacher workflow is covered (§5).
- **G8.** A teacher who starts on any day of the school year is on a correct timeline within one setup session.
- **G9.** Pilot teachers on Tala 0.4.x upgrade in place and keep every classroom-activity feature.

### 4.2 Non-goals

- Tala is not a school or division system. It has no administrator accounts, no approval chains, no reporting upward.
- Tala is not a gradebook, attendance register, or student information system.
- Tala does not teach students. That is the Hiraia student app.
- Tala does not replace the teacher's judgment. Generated plans are drafts and are labelled as such until the teacher locks them.
- Tala does not check a plan's curriculum alignment or a teacher's credentials. Both are the teacher's own responsibility.
- Tala is not an official DepEd product and must not present itself as one.

### 4.3 Design principles

These three principles govern every screen and every engineering choice. Where an earlier requirement in this document conflicts with them, the principle wins; the conflicts found so far are resolved in §18.3.

1. **Hiraia branding, with Tala teal as the accent.** Tala looks and reads as part of Hiraia: its name, glyph, colours and display typeface. The Hiraia brand colours are the base; **Tala teal is kept as the named accent of Tala's design language.**
2. **Simplicity over sophistication.** The users are teachers, not technical people. Every design choice defaults to the simplest option that works.
3. **Resilient by default.** Bad connectivity, small screens and low-end hardware are the norm, not edge cases. Every feature has a fallback that softens the problem instead of failing.

#### 4.3.1 Hiraia branding

Tala reuses the existing Hiraia brand. It does not get a new palette.

**Brand values, as found in the repository on 13 November 2026:**

| Token | Value | Source file | Use in Tala |
|---|---|---|---|
| Forest (ink) | `#1C3B2E` | `packages/brand/README.md`; also `--ink` in `packages/web/src/app/globals.css` | Text, headers, primary buttons |
| Cream | `#F5ECD6` | `packages/brand/README.md`; `packages/tala/brand/README.md` | App background |
| Plate white | `#FFFFFF` | `--plate` in `packages/web/src/app/globals.css` | Cards, editor surface, PDF page |
| Wordmark gold | `#BD8928` | `packages/brand/README.md` | Wordmark and decoration only |
| Glyph yellow ("family gold") | `#E9B949` | `packages/brand/README.md`; `packages/tala/brand/README.md` | Glyph, highlights, accents on forest |
| Brick | `#7A2E22` | `--accent` in `packages/web/src/app/globals.css` | Errors, conflicts, destructive actions |
| Sage | `#8C9E6E` | `--sage` in `packages/web/src/app/globals.css` | "Taught" and success states, with an icon |
| **Tala teal — the Tala accent** | `#2F6360` | `--teal` in `packages/web/src/app/globals.css` | The one accent colour that says "this is Tala": launcher icon, the active item in the navigation bar, selected and "today" states, the fill of the primary button, progress and pacing indicators, focus rings, links. Final per Luis. |

**Typography:** display type is **Fraunces SemiBold**, the approved Hiraia display face (`packages/brand/README.md`; bundled file `packages/brand/fonts/Fraunces-SemiBold.ttf`, 73 KB, covering Filipino accents). Body and interface text use the **device's system font**: it costs nothing to download, renders fastest, and is the most readable at small sizes for long lesson text. The hand-drawn faces in the student app (`packages/mobile/src/theme.ts`) belong to the student experience and are not used in Tala.

**Logo and name:** the Hiraia glyph and wordmark from `packages/brand/assets/`, and the Tala wordmark and launcher icon from `packages/tala/brand/assets/`. The product is presented as "Tala" with the Hiraia glyph visible, as the 0.4.x dashboard already does.

**Contrast, measured from the values above:** forest on cream is 10.4:1 and forest on white 12.3:1, so body text is forest. Glyph yellow on forest is 6.7:1. Wordmark gold on cream is 2.6:1, so gold is never used for text. Tala teal is 6.8:1 on white (and under white text) and 5.8:1 on cream, so it is safe both as a fill with white labels and as text on either background. Yellow on teal is 3.7:1, so yellow is not used for text on teal.

**How the colours are layered.** Base: cream background, white surfaces, forest text. Accent: Tala teal, used sparingly, for the one primary action on a screen (SIMPLE-2) and for "where am I" and "what is selected". Gold and yellow are brand decoration (glyph, wordmark, small highlights). Brick and sage carry error and success states. If a screen has more than one teal element competing for attention, it has too much.

| ID | Requirement | Pri |
|---|---|---|
| BRAND-1 | Tala's colours, display font, glyph and wordmark come from the existing Hiraia brand assets listed above. No new palette is invented. | P0 |
| BRAND-1a | Tala teal (`#2F6360`) is a named token (`talaTeal`) and the app's single accent colour; `talaTealText` is an alias with the same value. The Hiraia base colours are never replaced by teal: backgrounds stay cream and white, text stays forest. The older 0.4.x app teal (`#087A78`) is not used anywhere in V1.0. | P0 |
| BRAND-2 | The values live in **one shared token file** used by the web app, the mobile app and the PDF template. No colour or font is hard-coded in a component. | P0 |
| BRAND-3 | One light theme. No dark mode and no user theming in V1.0. | P0 |
| BRAND-4 | Fonts are bundled or system; nothing is fetched from a font service at runtime. Only Fraunces SemiBold is bundled. | P0 |
| BRAND-5 | Every text and control colour pairing meets WCAG AA; pairings are checked in CI from the token file. | P0 |
| BRAND-6 | PDFs are black text on white with the Hiraia glyph small in the footer, so they print cleanly on a school's monochrome printer and never look like an official DepEd form. | P0 |

**Follow-up needed (the brand is not yet a single set of tokens).** The repository holds three slightly different sets of values: the brand package (cream `#F5ECD6`, golds `#BD8928` and `#E9B949`), the website's CSS variables (cream `#F4EAD5`, gold `#D8A03A`), and the student app's older notebook theme (paper `#fdfdf6`, ink `#0c343d`, teal `#165a6a`). Concrete follow-ups:

1. Create the shared token file (BRAND-2), taking `packages/brand/README.md` as canonical for forest, cream and gold, and the website variables for the supporting colours. Luis confirms the canonical cream and gold.
2. `talaTeal` is `#2F6360` in that file (decided by Luis, BRAND-1a).
3. Record the final tokens in the brand README so the three sources stop drifting.

#### 4.3.2 Simplicity over sophistication

| ID | Rule | Pri |
|---|---|---|
| SIMPLE-1 | **Simplest option that works.** When two designs both meet a requirement, the one with fewer screens, fewer controls and fewer concepts is chosen. A feature that needs a tutorial to be used is redesigned. | P0 |
| SIMPLE-2 | **One primary action per screen**, shown as one clearly dominant button. Everything else is secondary or under a "More" menu. | P0 |
| SIMPLE-3 | **No power-user chrome:** no toolbars full of icons, no dense data tables, no keyboard-shortcut dependence, no drag-and-drop as the only way to do something, no multi-pane layouts on phones, no customisable dashboards. | P0 |
| SIMPLE-4 | **Minimal settings.** The Settings screen holds only: language, account, school and school year, data saver, and sign out. Everything in Appendix B is Hiraia-side configuration, not a teacher setting. Per-class adjustments live with the class, behind "Advanced", and are never needed for normal use. | P0 |
| SIMPLE-5 | **Sensible defaults everywhere.** A teacher can accept every default during setup and get a correct, useful timeline. No setup step requires understanding pacing, buffers or weights. | P0 |
| SIMPLE-6 | **Plain language** in Filipino and English: everyday words a teacher uses, short sentences, no technical or product jargon ("sync conflict" becomes "This lesson was changed on your other phone"), no error codes shown alone. DepEd terms teachers already use (DLL, competency, quarter) are kept. | P0 |
| SIMPLE-7 | **Large touch targets:** at least 48 dp, with at least 8 dp between them; primary buttons full width on phones. Body text at least 16 sp. | P0 |
| SIMPLE-8 | **Every icon has a text label.** No icon-only navigation. | P0 |
| SIMPLE-9 | **Navigation is at most four destinations** on the phone's bottom bar: This Week, Lessons, Community, Class. Any lesson is reachable in three taps from launch. | P0 |
| SIMPLE-10 | **Every state says what to do next.** Empty, loading, offline and error states each carry one sentence and one action. | P0 |
| SIMPLE-11 | **Undo over confirm.** Routine actions are immediate with an Undo; confirmation dialogs are kept for lock, unlock, delete and post. | P1 |
| SIMPLE-12 | **Little motion.** No decorative animation; the system's reduced-motion setting is honoured. | P0 |
| SIMPLE-13 | Before each phase exit, the main flows (set up a class, see this week, generate, edit, lock, download PDF, copy a community lesson) are tried by at least five teachers from last-mile schools on their own phones, without help. A flow most of them cannot finish is a release blocker. | P0 |

#### 4.3.3 Resilient by default

The app is designed first for the worst realistic conditions: a 2 GB Android 8 phone, a 5-inch screen, a weak or absent signal, little free storage. Better conditions make it faster, never different. The hard targets and fallbacks are in §14.1 and §14.2; the rules are:

- **Degrade, never fail.** Each feature has a defined lesser form for bad network, small screen, low memory and low storage (the ladder in §14.2).
- **Nothing blocks.** No full-screen spinner without a Cancel, no screen that waits on the network to show saved data, no forced update.
- **Lightweight is a feature.** Size, memory and data budgets in §14.1 are release gates, checked on every build.
- **A lighter path is the requirement.** Where a capability can be built richly or lightly, V1.0 requires the light version; the rich one is optional and must fall back to it.

---

## 5. Competitive benchmark: Chalk / Planboard

Planboard (Chalk, now part of PowerSchool **[verify]** current ownership and free-tier terms) is the reference for the individual-teacher planning workflow.

### 5.1 Parity targets

| Planboard free-teacher capability | Tala V1.0 | Notes |
|---|---|---|
| Lesson editor: rich text, objectives, materials, assessment notes | Parity, structured | Sections, not a free canvas (§6.1) |
| Unit planning | Parity, simplified | A unit is an ordered group of lessons tied to competencies |
| Timetable and term setup, rotations, off days | Parity | Plus DepEd calendar presets (§7) |
| Realign after a missed day; copy / move / shift lessons | Better | Pacing engine proposes the realignment (§7.6) |
| Templates | Parity | Ships with DLL- and DLP-shaped templates |
| Standards tagging and coverage view | Better | Curriculum is preloaded; tagging is the default, not a chore |
| Attachments and photos | Parity, size-capped | Compressed on device |
| Share / import a lesson | Better | Community area with copy, modify and lineage (§11) |
| Day notes | Parity | |
| Print / export | Parity | PDF; DOCX export is P2 |
| Mobile quick edits with sync | Better | Full offline authoring (§10.4) |

### 5.2 Where Tala aims to be clearly better

| Planboard pain point | Tala response |
|---|---|
| Thin mobile app | Mobile is a complete client: read, write, lock, export, offline |
| Finicky formatting | Structured sections with constrained formatting; the PDF layout is the app's job |
| Setup effort | Curriculum, calendar presets and roster parsing do most of the setup |
| Desktop-centric unit planning | Units are a list that works on a 5-inch screen |
| US-centric standards and language | MATATAG competencies, Filipino and English UI and content |
| Assumes broadband | Offline-first, small payloads, data-saver mode |

### 5.3 Deliberate exclusions

Tala will not build these, in V1.0 or as a direction:

- **District/division ERP:** administrator dashboards, school-wide plan collection, compliance reporting, staff management.
- **SIS:** enrolment records, LIS/LRN synchronisation, report cards, transcripts, parent contact records.
- **Grading and attendance suites:** gradebooks, class records, attendance registers, behaviour tracking.
- **LMS functions:** assigning work to students, collecting submissions, student or parent logins.
- **Paid tiers.** There is no premium plan.

The roster in Tala exists to describe the class to the planner (size, grade groups) and to label the teacher's own documents. It is deliberately kept too thin to become an SIS (§12.5). The absorbed classroom-activity pillar (§6.7) shows what learners practised in the Hiraia student app; it is not attendance or grading, and its data stays on the teacher's phone.

---

## 6. Functional requirements by pillar

### 6.1 Planning core

| ID | Requirement | Pri |
|---|---|---|
| PLAN-1 | A lesson plan is a structured document: header (class, subject, grade level(s), date(s), duration, quarter/week), competencies, objectives, materials, procedure (ordered steps with time allocations), assessment, differentiation/remediation notes, reflection/remarks, attachments. | P0 |
| PLAN-2 | Each section is edited as **simple formatted text**: paragraphs, bold, italic, bulleted and numbered lists. This is the V1.0 requirement on every device, and it must stay responsive on the reference phone. No fonts, colours or free positioning. Tables that a template needs (the DLL grid, the multi-grade time blocks) are structured fields the app lays out, not tables the teacher draws. | P0 |
| PLAN-2a | Free-form tables and images placed inside the text. Images are otherwise added as attachments (PLAN-9). If offered, these are web-first and must display correctly, read-only if necessary, on the phone. | P2 |
| PLAN-3 | Templates define which sections appear and what they are called. V1.0 ships with DLL (weekly grid) and DLP (single detailed lesson) templates **[verify]** against the current DepEd formats, plus a multi-grade session template (§9.3). Teachers can save their own. | P0 |
| PLAN-4 | A plan may cover one session or a week of sessions for one subject (DLL style). | P0 |
| PLAN-5 | Units: an ordered, named group of plans tied to a set of competencies, with a summary of coverage. | P1 |
| PLAN-6 | Copy, move and shift: duplicate a plan to another date or class; move a plan; shift all plans from a date forward by N teaching days. | P0 |
| PLAN-7 | One plan can be applied to several sections; each section keeps its own date and its own taught/not-taught status. | P0 |
| PLAN-8 | Day notes: free text attached to a date and class, not to a plan. | P1 |
| PLAN-9 | Attachments: images and PDFs, compressed on device, capped per file and per account (limits are configuration, Appendix B). | P1 |
| PLAN-10 | Every save creates a revision; the teacher can view and restore earlier revisions. | P0 |
| PLAN-11 | Views: Today, Week, Month, and a per-subject list. On a phone every view is a plain scrolling list grouped by day; calendar grids appear only on wider screens. | P0 |
| PLAN-12 | After a session, the teacher marks it taught, partly taught, or not taught, with an optional remark. This feeds pacing (§7.5). | P0 |

### 6.2 Scheduling engine

| ID | Requirement | Pri |
|---|---|---|
| SCH-1 | A school year has a start date, end date, terms, and non-teaching days. Term structure is data, not code (§7.2). | P0 |
| SCH-2 | Calendar presets for DepEd school years 2026–2027 and 2027–2028 are offered at setup and can be edited. A teacher outside DepEd builds a calendar from a blank year. | P0 |
| SCH-3 | A class has a weekly timetable: for each subject, the days and minutes. Rotating schedules (e.g. Day A/B, alternating weeks) are supported. | P0 |
| SCH-4 | The teacher can mark any date as a non-teaching day (suspension, local holiday, school event, exam day) for one class or all classes, including retroactively. | P0 |
| SCH-5 | Shortened-period days: a date can carry a reduced time budget instead of being cancelled. | P1 |
| SCH-6 | Marking a disruption triggers the realignment flow in §7.6. | P0 |
| SCH-7 | Make-up days (e.g. Saturday classes) can be added as teaching days. | P1 |

### 6.3 Curriculum alignment

| ID | Requirement | Pri |
|---|---|---|
| CUR-1 | Tala carries the DepEd revised K–12 curriculum (MATATAG) as structured data for **all learning areas, Kindergarten to Grade 10**, and **core subjects only** for senior high (Grades 11–12). §6.3.1 names them. | P0 |
| CUR-2 | Each competency record has: stable Tala ID, official DepEd code where one exists, learning area, grade, quarter/term, sequence, content standard, performance standard, competency text in the official language of the guide, and source document with edition, date and page. | P0 |
| CUR-3 | Curriculum data is versioned. A plan records the curriculum version it was tagged against. When DepEd revises a guide, old tags continue to resolve and the teacher is offered a mapping to the new version. | P0 |
| CUR-4 | Every plan is tagged to one or more competencies. Plans created from the timeline or the generator are tagged automatically; tags are editable. | P0 |
| CUR-5 | Coverage view per class and subject: competencies planned, taught, and not yet scheduled, by quarter. | P0 |
| CUR-6 | **Teachers self-check the curriculum data.** Competencies are extracted from the official guides by Hiraia tooling (a language model may assist) and loaded without a separate paid or staff verification pass. Extraction is always from the source document; a competency is never written from a model's recall. Each record links to its source guide and page so the teacher can check it. | P0 |
| CUR-7 | Every competency shows its check status: *not yet checked* or *checked by N teachers*. A teacher can mark a competency as matching their guide, or report and correct an error (wrong text, code, quarter or order). | P0 |
| CUR-8 | A teacher's correction applies to their own account immediately. Corrections reported by several teachers, or confirmed by Hiraia against the source, are published to everyone as a curriculum data update without an app release. | P0 |
| CUR-9 | **No automated alignment verification.** Tala does not judge whether a plan's content actually meets its tagged competencies. The tags record the teacher's intent; checking alignment is the teacher's self-check, and locking is where they affirm it (§10.2). | P0 |
| CUR-10 | A class can be set to **no preloaded curriculum**. The teacher types their own objectives; planning, scheduling, generation and sharing all work; the timeline shows planned lessons without competency pacing. This is the path for subjects not loaded and for teachers outside DepEd. | P0 |
| CUR-11 | Tala serves the curriculum in force for each grade in the school year the class belongs to. By SY 2027–2028 every grade from K to 10 is expected to be on MATATAG **[verify]** the phased rollout schedule; SY 2026–2027 demo classes use what is in force for that year. | P0 |
| CUR-12 | Curriculum browse and search by grade, learning area, quarter and keyword, available offline for the teacher's own grades and subjects. | P0 |
| CUR-13 | Teacher-defined competency lists (a custom curriculum) and local contextualisation notes on a competency. | P2 |

#### 6.3.1 Curriculum scope for V1.0

**Kindergarten to Grade 10: every learning area.** **[verify]** the list against the current curriculum guides:

- Kindergarten curriculum
- Grades 1–3: Language, Reading and Literacy, Mathematics, Makabansa, Good Manners and Right Conduct (GMRC); Filipino and English from Grade 2; Science from Grade 3
- Grades 4–10: Filipino, English, Mathematics, Science, Araling Panlipunan, MAPEH (Music and Arts, Physical Education and Health), EPP/TLE, GMRC/Values Education

**Senior high (Grades 11–12): core subjects only.** Under the strengthened SHS curriculum these are **[verify]**: Effective Communication (Mabisang Komunikasyon), Life and Career Skills, General Mathematics, General Science, and Pag-aaral ng Kasaysayan at Lipunang Pilipino. The set loaded is whichever core set is in force for SY 2027–2028.

**Post-V1.0:** SHS electives and track/strand specialised subjects, ALS, SPED-specific curricula, and non-DepEd curricula. Teachers of these use CUR-10.

A subject and grade whose data has not been loaded yet shows as "curriculum not yet loaded" and behaves as CUR-10. Loaded-but-unchecked data is usable and labelled (CUR-7). Because accuracy outranks breadth, two rules hold regardless: competency text shown in a plan header is always the stored record, and the generator is given only stored records, never asked to supply competencies itself.

### 6.4 LLM lesson generation

Specified in full in §9. Summary: generate a structured, editable draft from scheduled competencies, the class profile, available materials and a time budget; multi-grade (up to four grade levels) is a first-class input; any section can be regenerated; prompts are versioned.

### 6.5 Sharing and community

Specified in full in §11. Summary: a shared area where teachers post lessons, and other teachers copy and modify them. No comments or discussion in V1.0.

### 6.6 Access

Specified in full in §13. Summary: web app at `tala.hiraia.org`, Android app built with Expo/React Native, open sign-up, email/password in Phase 1, Google sign-in required before production.

### 6.7 Classroom activity (absorbed from Hiraia Tala 0.4.x)

The behaviour to preserve is the 0.4.4 build as documented in `packages/tala/README.md` and the 0.4.x release notes; that documentation is the parity specification and is not restated here.

| ID | Requirement | Pri |
|---|---|---|
| ACT-1 | Feature parity with Hiraia Tala 0.4.4 on Android: class QR with the teacher's public key, the temporary backup code, Nearby collection of encrypted activity batches with acknowledgement and duplicate tolerance, the connected-learner roster and per-learner activity pages, remove-from-class and left-class records, and the bundled append-only card catalog. | P0 |
| ACT-2 | **In-place upgrade.** Same package (`com.hiraia.tala`), same established pilot signing key, higher version code. Classes, key pairs and received activity in the 0.4.x local database are migrated without loss. Class QR identities do not change, so student phones do not re-join. | P0 |
| ACT-3 | Wire compatibility with the Hiraia student app versions in the field at release (0.4.24 and later). Catalog IDs stay append-only. | P0 |
| ACT-4 | Collection keeps working with no internet and **without a Tala account**. An upgraded pilot teacher who never signs in loses nothing. Planning features ask for sign-in; on first sign-in the phone's existing classes are attached to the account. | P0 |
| ACT-5 | **Activity data stays on the teacher's phone.** It is not uploaded to the Tala server, not synced to the web app, and never sent to a language model in V1.0. | P0 |
| ACT-6 | One class entity. A learner who joins by QR appears as a connected learner. Linking a connected learner to a roster row (§12) is an explicit teacher action and is never done automatically by name matching. | P0 |
| ACT-7 | Collection requires Android 10+ as today; on older supported phones the planning features work and collection is shown as unavailable. The web app has no collection. | P0 |
| ACT-8 | The first-launch tutorial is rewritten to cover both planning and collection. | P1 |
| ACT-9 | Activity informs planning: the timeline shows which scheduled topics the class has practised. | P2 |

Until ACT-1 to ACT-4 pass on real phones, 0.4.x remains the build pilot schools receive.

---

## 7. Curriculum Pacing Engine (teaching timeline)

This is the feature that makes Tala open on the right page. It answers one question for every class and subject: *given the curriculum, this school's calendar, and what has actually been taught, what is due now?*

### 7.1 What the teacher sees

On sign-in the home screen is the **timeline**:

- **This week:** for each class and subject, the competencies scheduled for each teaching day, each with a state: *no plan yet*, *draft*, *locked*, *taught*. One tap on "no plan yet" opens Create (write, generate, or find in the community).
- **This month:** the same at lower resolution, with a pacing indicator per subject: on pace, N sessions behind, N sessions ahead.
- **Needs attention:** disruptions not yet realigned, competencies at risk of not fitting in the term, plans that reference a superseded curriculum version.

The timeline is computed on the device from synced data, so it works offline (§10.4).

### 7.2 School year, terms and calendar

- A **school year** belongs to a teacher's school profile and has dated **terms**. The number of terms is data. The engine makes no assumption that there are four quarters.
- Presets ship for DepEd **SY 2026–2027** (for demonstrations and early users) and **SY 2027–2028** (the launch year). **[verify]** each against the DepEd school calendar order for that year; the 2027–2028 order may not exist yet, in which case a provisional preset is shipped, labelled provisional, and replaced by data update.
- A calendar holds **non-teaching days** of four kinds: national holidays (preset), DepEd calendar events such as examination and in-service days (preset), local holidays and school events (teacher-entered), and class suspensions (teacher-entered, usually after the fact).
- Calendar presets are published by Hiraia as versioned data and can be corrected without an app release.
- Between school years the timeline shows the upcoming year in preview so a teacher can set up and plan ahead.

### 7.3 Pacing model

**Inputs**

1. The **competency sequence** for a subject and grade in a term, from curriculum data.
2. A **weight** per competency: the relative share of teaching time it should receive. Where an official guide or Budget of Work gives a time allotment **[verify]** availability per subject, the weight comes from it and is marked *official*. Otherwise weights default to equal and are marked *estimated*. The interface always shows which.
3. The class's **available sessions** in the term: timetable × calendar, minus non-teaching days, with minutes per session.
4. **Reserved sessions:** assessment, review, and buffer.

**Computation**

The engine distributes the term's non-reserved sessions across the competency sequence in proportion to weight, in order, giving each competency a whole number of sessions with a minimum of one where the term allows. The output is a **pacing plan**: an ordered list of (competency, session dates). It is deterministic, runs on the device, and uses no language model.

**Everything is adjustable**

Pacing parameters are settings, with defaults, at three levels: Hiraia-published defaults (changeable by data update), per teacher, and per class-subject track.

| Parameter | Default | Adjustable by |
|---|---|---|
| Competency weights | Official where available, else equal | Teacher, per track |
| Competency order within a term | Guide order | Teacher, per track |
| Which term a competency belongs to | Guide | Teacher, per track |
| Buffer sessions | One per ten teaching sessions | Teacher, per track; default by Hiraia |
| Assessment and review sessions per term | From calendar preset | Teacher |
| Minimum sessions per competency | One | Teacher |
| Session length and days | Timetable | Teacher |
| "Assumed taught" behaviour (§7.5) | On | Teacher |
| Multi-grade pairing rule (§7.4) | Theme first, then sequence | Teacher, per class |

These adjustments sit behind "Advanced" on the class screen (SIMPLE-4). The everyday pacing controls are only three: move a competency earlier or later, give it more or fewer sessions, and mark a day as no class. A teacher never has to open Advanced to get a correct timeline.

The pacing plan is a proposal the teacher owns. They can also pin a competency to a date or merge two competencies into one session. Manual changes are kept as overrides and survive recomputation. "Reset to defaults" is available per track.

### 7.4 Subject and section mapping

- A **class** is the unit the teacher creates: a group of learners in a room with a timetable. It has **one to four grade groups** (one for a normal class, two to four for a multi-grade class).
- A **teaching assignment** links a class (or one grade group of it) to a learning area and to the timetable slots for it.
- Each (teaching assignment × grade group) has its own **pacing track**. A subject teacher with Science in three Grade 7 sections has three tracks that start identical and may drift.
- **Multi-grade classes:** each grade group has its own track per subject, but they share timetable slots. For each shared slot the engine proposes a **pairing**: the competencies of each grade group that will be taught in that session. Pairings are proposed where competencies share a theme (the same strand or domain across grades) and fall back to sequence order where they do not. With three or four groups, the engine may propose a theme shared by only some of the groups and says which. Pairings are editable. A paired session is the input to multi-grade generation (§9.3).
- A subject that only some grade groups take (Science does not start until Grade 3 **[verify]**) leaves the other groups in that slot with their own assigned subject or independent work, chosen by the teacher.

### 7.5 Starting on any day, and tracking what happened

**Onboarding at any point in the year (P0).** Tala must be as useful to a teacher who starts in November as to one who starts on the first day.

- When a class is created after the school year has begun, Tala proposes a starting position for each subject from the calendar (the competency the default pacing would have reached today) and labels it an estimate. The teacher confirms or picks the competency they are actually on.
- Competencies before the starting position are recorded as *covered before Tala*. They count as covered, need no plans, and never show as a deficit.
- Pacing for the rest of the term is computed from the starting position over the remaining sessions. If the remainder does not fit, the at-risk warning and the realignment options in §7.6 apply from day one.
- Setup to a populated timeline takes one sitting: school year preset, class and grade groups, timetable, starting positions. The roster is optional and can come later.
- A **sample class** with a fictional roster and a few example plans can be added in one tap and removed in one tap. It is labelled as sample data everywhere and cannot be posted to the community. It exists so the app can be demonstrated, and tried, without real student data.

**Tracking.**

- The timeline moves by the calendar; the pacing position moves by what the teacher marks (PLAN-12). A session marked *not taught* or *partly taught* leaves its competency open.
- If the teacher marks nothing, Tala assumes sessions happened as planned and says so ("assumed taught") so that an untouched account does not show a false deficit. A single tap corrects any assumed session.

### 7.6 Disruption shifting

When teaching days are lost (SCH-4) or sessions are marked not taught, the affected tracks no longer fit. Tala never silently reschedules. It shows the effect and offers:

| Option | What it does |
|---|---|
| **Shift** | Push everything after the gap forward. Shows what falls off the end of the term. |
| **Absorb** | Use buffer sessions first, then shift the remainder. Default when buffer is available. |
| **Compress** | Reduce session counts on later multi-session competencies, lowest weight first, never below the configured minimum. |
| **Merge** | Combine two adjacent competencies into one session, chosen by the teacher. |
| **Add time** | Add make-up days (SCH-7). |
| **Defer** | Carry named competencies into the next term, flagged in the coverage view. |

Rules:

- Realignment is previewed and applied only on confirmation, and is reversible as one step.
- Existing plans move with their competency. Locked plans keep their content and lock; only their scheduled date changes, and the PDF's date field is regenerated on next export.
- A disruption applied to "all classes" produces one combined preview.
- Realignment works offline and syncs as an ordinary change.

### 7.7 Requirements

| ID | Requirement | Pri |
|---|---|---|
| PACE-1 | Timeline home screen as in §7.1, computed on device. | P0 |
| PACE-2 | Deterministic pacing computation as in §7.3, identical on web and mobile for the same inputs (one shared TypeScript module, §13.5). | P0 |
| PACE-3 | Official versus estimated weights are distinguished everywhere they appear. | P0 |
| PACE-4 | Per-track pacing with multi-grade pairing for up to four grade groups as in §7.4. | P0 |
| PACE-5 | Any-day onboarding with proposed starting positions and *covered before Tala* as in §7.5. | P0 |
| PACE-6 | Disruption options Shift, Absorb, Merge, Defer with preview and undo. | P0 |
| PACE-7 | Compress and Add time. | P1 |
| PACE-8 | "At risk" warning when remaining competencies exceed remaining sessions. | P0 |
| PACE-9 | Optional weekly notification on mobile: "This week: N sessions, M without a plan." | P1 |
| PACE-10 | Every parameter in the §7.3 table is adjustable at the stated level, with reset to defaults. Hiraia defaults are data, not code. | P0 |
| PACE-11 | Sample class as in §7.5. | P0 |

---

## 8. Classes

A class has: name, school, school year, one to four grade groups, learner count per group (from the roster or typed), language(s) of instruction, curriculum (DepEd, or none per CUR-10), timetable, and an optional **class profile** used by the generator: available materials and facilities (electricity, projector, printed modules, textbooks by title, outdoor space), and free-text notes about the group as a whole.

The class profile describes the class in aggregate. It has no per-student fields beyond the roster in §12. On Android the same class carries the QR identity used for activity collection (§6.7).

---

## 9. LLM specification

### 9.1 Models and routing

| Item | Value |
|---|---|
| Primary model | DeepSeek v4.1 Flash, via DeepSeek's API |
| Primary credential | Environment variable `DEEPSEEK_API_KEY`, server-side only |
| Primary model identifier | Environment variable `TALA_LLM_PRIMARY_MODEL`. The exact API model string is taken from DeepSeek's documentation at integration time **[verify]**; it is configuration, not code. |
| Fallback model | Qwen, called directly on Alibaba Cloud's own API (Model Studio), not through a reseller or aggregator |
| Fallback credential | Environment variable `DASHSCOPE_API_KEY` **[verify]** the current variable convention, server-side only |
| Fallback model identifier | Environment variable `TALA_LLM_FALLBACK_MODEL`. The Qwen variant is chosen by running the §9.6 evaluation set (§19, item 6). |
| Local model (production route for student data, §12.4) | `TALA_LLM_LOCAL_ENDPOINT`, `TALA_LLM_LOCAL_MODEL` |
| Call path | Every model call goes through one server-side gateway. Clients never call a model provider directly. |

No credential appears in the repository, the client bundle, logs, or this document.

**Provider chain:** DeepSeek first. On a timeout, a provider error, a rate limit, or output that fails validation after one retry, the same request goes to Qwen. If Qwen also fails, the teacher gets a clear failure with their inputs preserved. Both providers' prompts are covered by the evaluation set; a template is not released unless it passes on both.

The gateway owns: prompt assembly from versioned templates, output schema validation, retries, the provider chain, per-teacher quotas, cost metering, and per-feature routing and redaction rules.

### 9.2 Generation inputs

| Input | Source | Required |
|---|---|---|
| Competencies | Selected from the timeline or curriculum browser and passed as stored records (ID, code, text, standards); or the teacher's own typed objectives for a class with no preloaded curriculum | Yes |
| Class profile | Grade group(s), learner count per group, language of instruction, materials and facilities (§8) | Yes |
| Time budget | Minutes for the session, or sessions × minutes for a weekly plan; defaults from the timetable | Yes |
| Template | DLL, DLP, multi-grade, or the teacher's own | Yes |
| Output language | Filipino or English, defaulting to the subject's language of instruction | Yes |
| Teacher guidance | Optional free text ("use the school garden", "no printing this week") | No |
| Prior context | Optional: the previous session's plan for continuity; what was marked partly taught | No |
| Source plan | Optional: a community plan to adapt | No |

**Never an input to lesson generation:** student names, IDs, classroom-activity data, or any roster field other than counts.

### 9.3 Multi-grade generation (first-class)

A multi-grade request describes **one session in one room with one teacher and two to four grade groups**, for example Grade 2 (11 learners) and Grade 4 (8 learners), 50 minutes, Science, each group with its own competencies from the pairing in §7.4.

The output must be a single session plan, not several plans side by side:

- **A shared opening and closing** where the competencies allow a common theme, and an explicit statement when they do not.
- **A parallel timeline:** for each time block, what each grade group is doing and where the teacher is. Exactly one group has direct instruction at any moment; every other group has an activity it can do without the teacher, with instructions a learner at that grade can follow.
- **Transitions** marked with the minutes they take.
- **Peer and cross-age roles** where suitable (older group assists younger), always optional.
- **Assessment per grade group**, tied to that group's competency.
- **Materials per group**, drawn only from what the class profile says is available.
- **Grade-appropriate difficulty:** the same theme at different levels, not the same task repeated.

With three or four groups the teacher's direct-instruction time per group is short. The generator must say so in the plan, favour pairing adjacent groups for part of the session where their competencies allow, and lengthen independent blocks instead of producing a rotation too fast to run. If the time budget cannot give every group at least one direct-instruction block, the plan says which group gets its turn in the next session.

The multi-grade template renders this as a time-block table with one column per grade group plus a teacher column, on screen and in the PDF (landscape for three or four groups). On a phone the columns collapse to a per-block stack.

**Supported combinations: any two, three or four grade groups.** Five or more is refused with a suggestion to split the class into two sessions.

Validation specific to multi-grade output: block times sum to the time budget; no block has the teacher with two groups unless those groups are explicitly paired; every group has an activity in every block; every competency supplied appears in objectives and in assessment.

### 9.4 Output

- The model returns **structured data matching the template's section schema**, not prose. The gateway validates it. Invalid output is retried once with the validation errors, then sent to the fallback model, then reported to the teacher as a failure with their inputs preserved.
- The draft opens in the normal editor, fully editable, marked **AI draft** until the teacher edits or locks it. The marker is recorded in provenance and carried into the community if posted (§11.3).
- Competency text shown in the plan header comes from the curriculum record, never from the model's wording.
- **When generation cannot run** (offline, both providers failing, allowance used up), the teacher is not left with an error. They are offered the template pre-filled with the scheduled competencies, class details and time blocks, ready to write by hand, with the generation request kept in the queue if they want it (LLM-7).
- Generation runs as a server job. The teacher can leave the screen or lose signal; the draft arrives on the next sync, and the wait always shows a Cancel.
- Structural validation is automatic. **Content alignment is not checked by Tala** (CUR-9). Every draft carries a standing notice: check facts, examples, answers and fit to the competency before use. Locking is the teacher's sign-off.

### 9.5 Regeneration

| ID | Requirement | Pri |
|---|---|---|
| LLM-1 | Generate a full draft from the inputs in §9.2. | P0 |
| LLM-2 | Multi-grade generation for two to four grade groups as in §9.3. | P0 |
| LLM-3 | Regenerate one section, optionally with an instruction ("shorter", "use a game", "no worksheet"). Other sections are passed as context and are not changed. | P0 |
| LLM-4 | Regeneration never overwrites silently: the previous text is kept as a revision and is restorable in one step. Sections the teacher has edited by hand ask for confirmation first. | P0 |
| LLM-5 | Adapt: rewrite a plan for a different time budget, materials list, language, or grade combination. | P1 |
| LLM-6 | Translate a plan between Filipino and English, section by section, preserving structure. | P1 |
| LLM-7 | Generation requests made offline are queued with their inputs and run when a connection returns; the teacher is told the request is waiting. | P1 |
| LLM-8 | Each generated section records provider, model, prompt template version, curriculum version, and timestamp. | P0 |

Cebuano and other languages are out of scope for generation in V1.0. The project's standing rule applies: no model's Cebuano is trusted without corpus or dictionary checks, and that checking pipeline does not exist for teacher-facing lesson text.

### 9.6 Prompt and version management

- Prompt templates live in the repository as versioned files with IDs (`lesson.multigrade.v3`), reviewed like code. No prompt text is edited in a database or admin screen. Moderation guidelines (§11.6) are versioned the same way.
- Each template has a fixed evaluation set: single-grade and multi-grade cases across learning areas and both languages, including at least the Grade 2 + Grade 4 case, a three-group case, a four-group case, a no-electricity classroom, a 30-minute shortened period, and a class with no preloaded curriculum.
- A template or model change ships only after the evaluation set is run on **both DeepSeek and Qwen** and compared with the current version on: schema validity, the multi-grade validation rules in §9.3, presence of every supplied competency, time-budget adherence, materials adherence, and a scored quality review of a sample by a teacher reviewer.
- Template version is selected by server configuration, so a bad version can be rolled back without a client release.
- Model output is treated as untrusted input: it is schema-validated, sanitised to the permitted formatting set, and never executed or used to construct queries. Teacher-supplied free text and community source plans are passed to the model as data with clear delimiters, and the output is checked the same way regardless of what they contain.

### 9.7 Cost and quotas

Every limit here is configuration (Appendix B), changeable without a release. No values are fixed in this document; initial values are set from measurements in alpha.

- Per-teacher allowance for full generations and for section regenerations, per day.
- A global monthly budget ceiling, with an alert threshold below it and a degraded mode (generation queued or limited) at it.
- Per-feature switches: each LLM-assisted feature in §9.8 can be turned off, or pointed at a different route (DeepSeek, Qwen, local, rules-only), independently.
- The gateway meters tokens and cost per feature and per provider.
- Identical requests within a short window are served from cache.

### 9.8 LLM-assisted data processing

The model is used across ingestion and cleaning wherever input is messy. In every case a deterministic step runs first, the model handles what is left, and its output is validated before anything is stored.

| Feature | What the model does | Primary | Fallback | Human check |
|---|---|---|---|---|
| Lesson generation, regeneration, adaptation | §9.2–9.5 | DeepSeek v4.1 Flash | Qwen; then fail with inputs kept | Teacher edits and locks |
| Roster ingestion and cleaning | §12.3 | **Pre-production:** DeepSeek v4.1 Flash, as a flagged activity (§12.4). **Production:** locally hosted model | Qwen pre-production; in all cases the deterministic parser plus manual mapping | Teacher confirms every uncertain row |
| Importing an existing plan (DOCX, PDF, pasted text) into Tala's sections | Maps content to sections; proposes competency tags | DeepSeek v4.1 Flash | Qwen; then import as one unstructured section | Teacher reviews mapping before save |
| Timetable entry from pasted text | Extracts days, times, subjects | DeepSeek v4.1 Flash | Qwen; then manual entry | Teacher confirms the grid |
| Competency tag suggestions for hand-written plans | Ranks candidates from the stored curriculum set only | Embedding search first; DeepSeek re-ranks | Embedding search alone | Teacher accepts or changes tags |
| Community moderation | Decides allow or return-to-author against loose guidelines (§11.6) | DeepSeek v4.1 Flash | Qwen; then rule-based detectors, with posting queued until a model check runs | None by default; staff takedown on escalation |
| Community search query understanding | Maps a free-text query to grade, subject, quarter, language filters | Deterministic parser first; DeepSeek for the remainder | Keyword search | None needed; filters are shown and editable |
| Curriculum guide extraction (internal tooling) | Extracts competencies from official PDFs into records with page references | Strongest available model, offline batch | None | Teacher self-check in the app (CUR-6 to CUR-8) |
| Calendar preset extraction (internal tooling) | Extracts dates from DepEd calendar orders | Same | None | Hiraia spot-check; teacher-editable |

General rules for all rows: outputs are schema-validated; a low-confidence or invalid result falls through to the manual path instead of being stored; the teacher can always do the step by hand; every stored result records that a model was involved and which one.

---

## 10. Document lifecycle

### 10.1 States

```
Draft ──lock──▶ Locked ──unlock──▶ Draft (new revision)
  │                │
  └── archive      └── post snapshot ──▶ Community version (immutable)
```

- **Draft:** editable. AI drafts carry the AI-draft marker until edited or locked.
- **Locked:** the teacher has declared the plan final. It is read-only on every device.
- **Archived:** hidden from the timeline, retained, restorable.

### 10.2 Lock and unlock rules

| ID | Requirement | Pri |
|---|---|---|
| DOC-1 | Locking records who, when, and the exact revision. Locking requires no empty required section and, for a class with a preloaded curriculum, at least one competency tag. The lock dialog reminds the teacher that locking is their own check of accuracy and alignment. | P0 |
| DOC-2 | A locked plan cannot be edited, regenerated, or deleted. It can be copied, exported, shared, posted, rescheduled by the pacing engine, and annotated with post-lesson remarks (taught status and reflection are outside the lock). | P0 |
| DOC-3 | Only the owner can unlock. Unlocking asks for confirmation, records the event, and creates a new draft revision; the locked revision remains in history with its PDF reproducible. | P0 |
| DOC-4 | Locking and unlocking work offline. On sync, a lock made on one device wins over unsynced edits made on another device to the pre-lock revision; those edits are kept as a separate draft copy, not discarded (§10.5). | P0 |
| DOC-5 | A locked plan can be marked **submitted** with a date and a free-text note of to whom. This is a record for the teacher. Tala does not deliver the plan to anyone or track approval. | P1 |
| DOC-6 | Unlocking a plan marked submitted shows a stronger warning and clears the submitted mark on the new revision only. | P1 |
| DOC-7 | Posting to the community requires a locked plan. The community version is a snapshot; unlocking the original does not change it (§11.2). | P0 |

### 10.3 PDF

| ID | Requirement | Pri |
|---|---|---|
| PDF-1 | Any plan can be downloaded as a PDF in A4 and in the long-bond size commonly used in Philippine schools (8.5 × 13 in), portrait or landscape per template. | P0 |
| PDF-2 | Layout follows the template: DLL as a weekly grid, DLP as a detailed single lesson, multi-grade as the time-block table (landscape when there are three or four grade groups). Header fields (school, teacher, grade, learning area, dates, quarter) are filled from class data. **[verify]** layouts against current DepEd-issued formats. | P0 |
| PDF-3 | A PDF of a draft is watermarked DRAFT. A PDF of a locked plan carries the lock date and a short revision code in the footer, so a printed copy can be matched to its revision. | P0 |
| PDF-4 | PDFs are generated **on the device** on mobile, so export works offline. Web and mobile render the same HTML print template, so output for the same revision is visually equivalent. | P0 |
| PDF-4a | **Fallbacks.** If on-device PDF creation fails or the phone is short of memory: first retry without images; then offer the plan as a plain printable page or text that can be shared or copied; and, when online, offer a server-made PDF. The teacher always leaves with something they can print or send. | P0 |
| PDF-5 | Fonts are embedded and cover Filipino orthography including ñ and diacritics. | P0 |
| PDF-6 | Batch export: a week of plans for a class as one PDF. | P1 |
| PDF-7 | Signature lines ("Prepared by", "Checked by") are included per template and left blank. | P0 |
| PDF-8 | Typical file size for a text-only plan is under 300 KB. Images are downsampled for export. | P1 |

### 10.4 Automatic offline use on mobile

The mobile app is offline-first: it reads and writes a local SQLite database, and sync runs in the background when a connection exists.

**What is on the phone without the teacher asking**

- All of the teacher's plans dated from four weeks back to eight weeks ahead, in every state, plus all locked plans of the current term. (The window is configuration.)
- Class, timetable, calendar, roster and pacing data for the current school year.
- The curriculum data pack for the teacher's own grades and subjects, covering every grade group of a multi-grade class.
- Templates, and the fonts and layout assets for PDF export.
- Community plans the teacher has copied or saved.

Older plans are fetched on demand and can be pinned. Attachments follow a data-saver rule: thumbnails always, full files on Wi-Fi or on request.

**What works offline:** timeline, viewing, creating and editing plans by hand, lock and unlock, PDF export, marking sessions taught, disruption realignment, roster viewing and manual editing, curriculum browse and self-check marks, classroom-activity collection.

**What needs a connection:** generation and regeneration (queued, LLM-7), roster file parsing with model assistance (the deterministic parser still runs offline), community search, posting, sign-in on a new device.

| ID | Requirement | Pri |
|---|---|---|
| OFF-1 | Local-first storage and background sync as described. No screen waits on the network to render saved data. | P0 |
| OFF-2 | Automatic offline set as listed, refreshed on every successful sync. | P0 |
| OFF-3 | A persistent, unobtrusive sync indicator: last synced time, items waiting to upload, and any item in conflict. | P0 |
| OFF-4 | Sync is incremental and resumable; an interrupted sync never leaves a plan half-written. | P0 |
| OFF-5 | A signed-in session survives at least 30 days without a connection. Local data is encrypted at rest. | P0 |
| OFF-6 | First sync for a typical teacher (one school year, text only) is under 5 MB; a normal daily sync is under 200 KB. | P1 |
| OFF-7 | The web app keeps the current week readable offline and preserves unsaved edits through a connection loss. Full offline authoring on web is not required. | P1 |

### 10.5 Conflict handling

A plan is stored as independently versioned sections, so two devices editing different sections never conflict.

| Situation | Resolution |
|---|---|
| Different sections edited on two devices | Merged automatically. |
| Same section edited on two devices | Both versions kept. The teacher is shown the two versions, one above the other on a phone, each labelled with the device and time, and picks "Keep this one", "Keep the other" or "Keep both" (the second is added below the first to tidy by hand). No merge tool. Until then the plan shows a conflict badge and the most recently edited version is displayed. Nothing is discarded. |
| Edited on one device, locked on another | The lock stands. The edit is saved as a new draft copy linked to the locked plan, and the teacher is told. |
| Edited on one device, deleted on another | The edit wins; the plan is restored. |
| Pacing or timetable changed on two devices | Field-level last-writer-wins, with the realignment preview recomputed and shown if the result differs from what either device saw. |
| Roster edited on two devices | Row-level merge; a row edited on both is flagged for the teacher. |

Device clocks are not trusted for ordering; the server assigns sequence on receipt, and per-section version counters detect concurrent edits.

---

## 11. Sharing and community

### 11.1 Principles

- There is one **shared community area**. Teachers post lessons there; other teachers copy them and modify the copy. That is the whole mechanic in V1.0.
- **No commenting, no discussion threads, no ratings, no messaging** in V1.0.
- **Anyone with a Tala account can browse, copy and post.** There is no teacher verification, no DepEd-account requirement, and no restriction by country or school type.
- Browsing requires sign-in, and community pages are not indexed by search engines in V1.0.
- Sharing is opt-in per plan. Nothing is public by default.
- No student personal data, ever. Rosters, class profiles, activity data and post-lesson remarks are never part of a posted lesson.
- Credit is permanent and automatic.

### 11.2 Lesson artifact model

| Entity | Description |
|---|---|
| **Artifact** | The public identity of a posted plan: stable ID, author, title, summary, tags, licence, current version. |
| **Version** | An immutable snapshot of a locked plan's content and attachments at posting time. Posting again from a newer locked revision adds a version; older versions stay reachable. |
| **Lineage link** | From an artifact to the specific version it was copied from. Forms the remix tree. |

Posted content is stripped of: school name (unless the author opts to show it), section name, dates, roster references, day notes, remarks, and signature blocks. A pre-post screen shows exactly what will be public.

### 11.3 Attribution and provenance

- Every artifact shows its author's display name, and optionally school and place. These are self-declared and shown as such.
- A posted modification permanently shows "Adapted from *title* by *author*", linking to the exact source version, with the full chain viewable.
- If a source is later removed, derived artifacts keep the credit line and show the source as unavailable.
- Provenance flags are displayed: *AI-drafted* (any section originated from generation and the artifact has not been substantially rewritten), *adapted*, *original*. Flags are computed from revision history, not self-declared.
- Authors can post under their name or a consistent pseudonym.

### 11.4 Curriculum tags and discovery

Every artifact carries: grade level(s), learning area, quarter/term, competencies (from the plan's tags, with curriculum version) or "no preloaded curriculum", language, template type, duration, **multi-grade combination** if any, materials required, and region (author's, optional). Tags are the author's own claim; Tala does not verify that a lesson meets them (CUR-9).

| ID | Requirement | Pri |
|---|---|---|
| COM-1 | **Post** a locked plan, with the pre-post review screen and licence confirmation. | P0 |
| COM-2 | Browse, search and filter by grade, subject, quarter, competency, language, region, multi-grade combination, and duration. | P0 |
| COM-3 | From any "no plan yet" slot on the timeline, show community plans matching that competency, grade and language. | P0 |
| COM-4 | **Copy:** copies a version into the teacher's own plans as a draft with a lineage link. The copy is private and independent, and fully editable. | P0 |
| COM-5 | **Post a modification:** a copied plan, once edited and locked, can be posted as a derived artifact with automatic attribution. | P0 |
| COM-6 | Each artifact shows how many times it has been copied. Authors see this for their own artifacts. This is the only popularity signal. | P1 |
| COM-7 | Ranking favours competency match and copy count, shows provenance flags, and does not favour recency alone. | P1 |
| COM-8 | A **Report** button on every artifact (§11.6). It is a flag with a reason, not a comment; nothing the reporter writes is shown publicly. | P0 |
| COM-9 | Copied and saved artifacts are available offline (§10.4). Search needs a connection. | P0 |
| COM-10 | Share a single plan by private link or file to another Tala user without posting it. | P1 |
| COM-11 | Comments, ratings, collections, follows, and school/division circles. | P2 |

### 11.5 Privacy controls

- Visibility per artifact: private (default) or community.
- The author can remove a post at any time. Removal takes the artifact out of search and off the author's profile. Copies already made by others remain with those teachers, with attribution, because the licence that was granted is not revocable; the pre-post screen says this plainly.
- Profile fields are individually optional: display name is required, everything else can be hidden.
- The check for student names and other personal data runs before an artifact becomes visible (§11.6).

### 11.6 Moderation

Moderation in V1.0 is **done by the language model, against deliberately loose guidelines**. There is no human review queue and no moderator staffing. The guidelines are expected to tighten as real use shows what is needed; they are a versioned file (§9.6) and each feature below is a configuration switch.

**Initial guidelines.** A post is returned to its author only when it clearly falls into one of these:

1. **Student personal data:** a list of learner names, LRN-like numbers, phone numbers, home addresses, or photos of identifiable children.
2. **Plainly unsuitable content:** sexual content, hate or harassment, encouragement of violence or self-harm, or anything unlawful.
3. **Not a lesson:** advertising, spam, or content with no teaching purpose.

Everything else is allowed. The model does **not** judge quality, formatting, pedagogy, language, factual accuracy, or curriculum alignment, and when it is unsure it allows the post.

**Flow**

1. **At posting:** rule-based detectors (number and contact patterns, roster-like lists) and the model check the snapshot. Result is *allow* or *return to author* with the reason and the passage concerned. Allowed posts are visible immediately.
2. **Returned posts:** the author edits and posts again. There is no limit on attempts and no penalty.
3. **Reports:** a report triggers a fresh model check that includes the reporter's reason. A report of student personal data hides the artifact immediately while that check runs; if the check finds nothing, it is restored.
4. **Escalation:** an author who believes a return is wrong, or a reporter who believes an allow is wrong, can send it to Hiraia by a contact link. Hiraia staff have a takedown and restore switch. This is best-effort, with no response-time commitment in V1.0.
5. **Record:** every decision is logged with the guideline version, provider and model.
6. **Model unavailable:** DeepSeek, then Qwen. If neither responds, the post waits in "pending check" and becomes visible when a check completes.

Student personal data is the one category kept strict under otherwise loose guidelines (§19, item 5).

**Factual accuracy** is not moderated. Every community lesson carries a standing notice that lessons are shared by teachers as-is and should be checked before use.

### 11.7 Licence

- **Every artifact posted to the community is licensed Creative Commons Attribution-NonCommercial 4.0 (CC BY-NC 4.0).** Anyone may copy, use and adapt it with credit; it may not be sold or used commercially.
- BY-NC is the default and, in V1.0, the only licence offered. One licence keeps copy-and-modify free of compatibility questions: a modification of a BY-NC lesson is posted as BY-NC.
- Attribution is satisfied automatically by the lineage credit (§11.3) and is printed in the footer of a PDF exported from a copied lesson.
- There is no ShareAlike condition: a teacher who copies a lesson is not required to post their modified version.
- The author affirms at posting that the work is theirs or is properly adapted, and that it contains no student personal data.
- DepEd curriculum text quoted in plans is credited to DepEd. **[verify]** with counsel how government-works rules apply to reproduction of curriculum guide text inside a community library.
- Attachments must be the author's own or openly licensed; textbook scans are not allowed and are a report reason.

---

## 12. Rosters

### 12.1 Purpose and limits

Each class can have a student list. It is used to: count learners per grade group for the planner and generator, let the teacher keep their own list at hand, label learners who connect for activity collection (ACT-6), and (P2) print group lists. It is not an enrolment record.

### 12.2 Accepted input

The teacher should be able to hand Tala whatever they already have.

| ID | Requirement | Pri |
|---|---|---|
| ROS-1 | Accept: `.txt` (one name per line or free-form), `.csv`, `.tsv`, `.xlsx`, `.xls`, `.ods`, `.docx` containing a list or table, and text pasted into a box. | P0 |
| ROS-2 | Accept a text-based PDF. | P1 |
| ROS-3 | Accept a photo or scan of a printed or handwritten class list. | P2 |
| ROS-4 | Tolerate: any text encoding (detect; never corrupt ñ or accented letters), any delimiter, title rows and school letterhead above the table, blank rows, merged cells, multiple sheets (ask which, or detect), totals and signature rows at the bottom, numbering columns, sections for boys and girls with sub-headers, and mixed case. | P0 |
| ROS-5 | Accept anything from a single column of names to a full formal sheet with IDs, sex, birthdate, address, guardian and contact columns. Columns Tala does not keep are identified and discarded at import, before storage (§12.5). | P0 |
| ROS-6 | For a multi-grade class (up to four grade groups), accept a grade column, grade sub-headers, or one file per grade group; otherwise ask the teacher to assign groups after import. | P0 |
| ROS-7 | Manual add, edit, remove, and reorder at any time, online or offline. | P0 |
| ROS-8 | Re-upload later in the year: match against the existing roster, show additions, removals and changes, and apply only what the teacher approves. | P1 |
| ROS-9 | File limits (configuration; initially 5 MB and 500 rows per class). Larger files are refused with a clear message. | P0 |

### 12.3 Cleaning pipeline

```
Upload ─▶ 1 Extract ─▶ 2 Structure ─▶ 3 Normalise ─▶ 4 Check ─▶ 5 Teacher review ─▶ Save
           (code)      (code + LLM)    (code + LLM)    (code)      (required)
```

1. **Extract (deterministic).** Read the file into rows and cells. Detect encoding. Nothing is interpreted yet.
2. **Structure (deterministic first, model for the remainder).** Find the header row and the data region; drop letterhead, totals, and signature rows. **Map columns** to Tala's fields: full name, family name, given name, middle name or initial, suffix, sex, grade level, local ID. Identify columns to discard. Recognise Filipino and English header variants ("Pangalan", "Apelyido", "Name of Learner", "LRN", "Kasarian").
3. **Normalise (rules first, model for the remainder).**
   - **Name-order detection:** "DELA CRUZ, Juan Miguel S." versus "Juan Miguel S. Dela Cruz" versus separate columns.
   - **Combined-name splitting** into family name, given name(s), middle name/initial, suffix. Filipino naming is the baseline: multi-word given names (Juan Miguel, Maria Clara, Ma. → kept as written), compound and particle family names (Dela Cruz, De los Santos, Delos Reyes, San Jose, Sta. Maria, Macapagal-Arroyo), middle name as mother's maiden surname, suffixes (Jr., III). Names from other naming traditions are kept as written and flagged when the split is uncertain.
   - **Honorifics and annotations** removed from the name and reported: "Mr.", "Ms.", "(transferee)", "- moved", "✓", numbering.
   - **Casing** normalised for display (ALL CAPS → conventional capitalisation, preserving particles and letters such as ñ), with the original retained until the teacher confirms.
   - **Whitespace and punctuation** cleaned.
   - The original cell text is kept beside every cleaned value until the import is confirmed.
4. **Check (deterministic).**
   - **Duplicates:** exact and near-duplicate rows (same name with different casing, spacing, or initial versus full middle name) are grouped as *possible duplicates*. They are never merged automatically; two learners can share a name.
   - **Ambiguity flags:** a row is flagged when the split is uncertain (which words are given name versus family name), when it may not be a person (a header, a note, a total), when it may contain two people, when characters look corrupted, when a possible duplicate exists, or when the model and the rules disagree.
   - Every row gets a status: *clean*, *changed* (cleaned value differs from original beyond casing/whitespace), or *needs review*.
5. **Teacher review (mandatory).**
   - The teacher sees the column mapping and can correct it; a corrected mapping re-runs steps 3–4.
   - All *needs review* rows are listed first, each showing the original text, the proposed split, and the reason it was flagged. Each must be explicitly resolved: accept, edit, split into two, mark as not a student, or keep the original text exactly as typed.
   - *Changed* rows are shown with before and after and can be accepted together after viewing.
   - The import cannot be saved while any *needs review* row is unresolved. The teacher may save the resolved rows and leave the rest pending.
   - The teacher can at any point choose "import exactly as written": each non-empty line becomes one student with the full text as the display name and no splitting.

### 12.4 Rules the pipeline must never break

- **Never silently guess a student's identity.** No row is merged, dropped, split, or materially renamed without being shown to the teacher. Uncertain means flagged, not resolved.
- **Never invent data.** The model may reorganise and clean what is in the file. It must not supply a missing surname, expand an initial, infer sex from a name, or assign a grade level that is not in the file. Output is validated against the input: every character sequence in a cleaned name must be traceable to the source row, and any row failing that check is flagged and the model's proposal discarded.
- **Row conservation.** Rows in equals rows out plus rows explicitly marked as not-a-student; the count is shown to the teacher ("42 lines read: 38 students, 2 need review, 2 not students").
- **Deterministic fallback.** If the model is unavailable, over budget, switched off, or returns invalid output, the import proceeds with rules and manual column mapping. Roster import never fails because a model call failed.
- **Minimum data to the model, on every route:**
  - Column mapping uses headers and a small sample of rows with ID-like, date-like, phone-like and address-like cells masked before sending.
  - Name normalisation sends only the name cells of rows the rules could not resolve. Never IDs, birthdates, addresses, guardian names or contact details. No school name, class name or teacher identity accompanies the request.
  - Requests are not logged with their content.

#### 12.4.1 Model routing for roster data: flagged now, local for production

Sending learners' names to a cloud model is **allowed for now as a flagged activity**. It is not how production will run.

**Pre-production (alpha, beta, demos).** No real production data is expected in this period.

- AI cleaning of rosters is available and routes to the cloud chain (DeepSeek, then Qwen).
- It is **flagged every time it is used**. Before a file is processed the teacher sees, in Filipino and English: that the names in this file will be sent to a cloud AI service outside the Philippines; that this is an early-access feature; that it should be used with sample or test names, not a real class list; and a choice between **Clean with AI** and **Clean without AI** (rules-only, same review screen).
- Rosters cleaned this way carry a visible "cleaned with cloud AI (early access)" mark in the import history.
- The sample class (§7.5) gives demonstrators a fictional roster so no real list is needed.
- The flag, its wording, and the route are configuration: `TALA_ROSTER_LLM_ROUTE` = `cloud` | `local` | `rules`.

**Production.** Roster and any other student-data processing goes to a **locally hosted model** run by Hiraia, not a cloud provider.

- The production configuration sets the route to `local` (or `rules` if the local model is not ready). The `cloud` route cannot be enabled in the production environment; this is enforced in the gateway, not left to configuration discipline.
- The local model must pass the roster evaluation set (the adversarial set in §16, Phase 2) at least as well as the cloud route before it replaces it. Until it does, production runs rules-only for names.
- With processing kept on Hiraia's own infrastructure, the flag and its warning are replaced by the ordinary notice in PRIV-7.
- Migration: rosters cleaned on the cloud route during pre-production are test data. Pre-production accounts and their rosters are not carried into production unless the teacher re-imports.

Choice and hosting of the local model, and whether it later takes over lesson generation as well, are in §19 (item 2).

### 12.5 Student-data privacy (minors)

Rosters contain personal data of children. Requirements:

| ID | Requirement | Pri |
|---|---|---|
| PRIV-1 | **Stored fields are limited to:** display name, family name, given name, middle name/initial, suffix, grade group, sex (optional), and a teacher-assigned local ID (optional). | P0 |
| PRIV-2 | **Never stored:** LRN, birthdate, address, guardian details, contact details, photos, health, religion, ethnicity, 4Ps or other status flags, grades, attendance. Such columns are dropped at import in memory and the teacher is told which were dropped. Uploaded source files are deleted once the import is confirmed or abandoned, and within 24 hours regardless. | P0 |
| PRIV-3 | A roster is visible only to the teacher who owns the class. It is never shared, posted, included in community artifacts, or shown to other teachers. Hiraia staff access requires a logged, justified support action. | P0 |
| PRIV-4 | Student names are never sent to lesson generation, moderation prompts beyond the text the author chose to post, analytics, error reports, or logs. | P0 |
| PRIV-5 | Encryption in transit and at rest, on the server and on the device. | P0 |
| PRIV-6 | The teacher can delete a student, a roster, a class, or their whole account, with deletion propagating to devices on next sync and to backups within a stated period. Rosters of classes from ended school years are flagged for deletion and removed after a retention period unless the teacher keeps them. | P0 |
| PRIV-7 | At first roster import, a plain-language notice in Filipino and English states what is kept, what is discarded, and where any model processing happens. Pre-production, this is the stronger flag in §12.4.1. | P0 |
| PRIV-8 | **Before real student data is accepted in production:** the roster route is local or rules-only (§12.4.1), and a privacy impact assessment under the Data Privacy Act of 2012 (RA 10173) covering rosters and on-device activity data is completed. **[verify]** registration and other obligations with counsel. | P0 gate |
| PRIV-9 | PDFs and posted plans contain student names only if the teacher typed them into the plan body; the posting check (§11.6) looks for exactly this. | P0 |
| PRIV-10 | Classroom-activity data collected from student phones stays in the app's private storage on the teacher's phone (ACT-5), encrypted at rest, and is deleted with the class. | P0 |
| PRIV-11 | Because sign-up is open and unverified, nothing in Tala treats an account as a trusted school official. No feature exposes one teacher's roster or activity data to another account. | P0 |

---

## 13. Access, authentication and deployment

### 13.1 Surfaces

| Surface | Requirement |
|---|---|
| **Web** | Responsive web app served at `https://tala.hiraia.org`. Works on current Chrome, Edge, Firefox and Safari, and on Chrome for Android at 360 px width. |
| **Mobile** | Android app built with **Expo / React Native**, offline-first. Planning features target Android 8.0+ on devices with 2 GB RAM **[verify]** against the minimum Android version of the Expo SDK chosen. Activity collection needs Android 10+. Package `com.hiraia.tala`, upgrading Tala 0.4.x in place. Distributed as a signed APK from Hiraia's site, and through Google Play if the pilot key arrangement allows (§19, item 8). |
| **iOS** | Not in V1.0. The Expo codebase keeps it possible later; the web app must be usable on iPhone Safari. |
| **API** | One versioned API under `tala.hiraia.org` used by both clients. |

Environments: local, staging (a non-production hostname, used for demonstrations and invited testers), production (`tala.hiraia.org`). Production is not opened until the gates in §13.4 pass.

**Who can sign up:** anyone. No invitation, school code, DepEd email, or proof of employment is required in production. Staging is invitation-only because it is staging, not because of who the teacher is.

### 13.2 Phase 1 authentication: email and password only

| ID | Requirement | Pri |
|---|---|---|
| AUTH-1 | Register with email, password and display name. Any email domain is accepted. Email verification by link or code before posting to the community and before roster upload. | P0 |
| AUTH-2 | Password policy: minimum length 10, checked against known-breached passwords, no composition rules. Stored with a modern memory-hard hash (Argon2id). | P0 |
| AUTH-3 | Password reset by emailed single-use, short-lived link. Responses never reveal whether an email is registered. | P0 |
| AUTH-4 | Rate limiting and progressive delays on sign-in, registration and reset. Because sign-up is open, registration and posting also carry abuse limits per account, device and network (configuration). | P0 |
| AUTH-5 | Sessions: revocable, listed per device, with "sign out everywhere". Mobile sessions last long enough for OFF-5. | P0 |
| AUTH-6 | Account deletion and data export (the teacher's plans as PDF and a structured file). | P0 |
| AUTH-7 | Transactional email (verification, reset) from a `hiraia.org` address with SPF, DKIM and DMARC set. | P0 |
| AUTH-8 | Storage limits per account for attachments (configuration; initially 200 MB, 5 MB per file). | P1 |

### 13.3 Google sign-in: pre-production gate

Google sign-in is **required before production launch**. Phase 1 builds without it run only in local and staging.

| ID | Requirement | Pri |
|---|---|---|
| AUTH-9 | "Continue with Google" on web and Android, using OpenID Connect with the minimum scopes (identity and email). No access to Drive, Classroom, contacts or calendar. Any Google account is accepted: personal, school, or DepEd-issued. | P0 gate |
| AUTH-10 | A new Google sign-in creates an account with the email marked verified. | P0 gate |
| AUTH-11 | Accounts are keyed internally by a Tala user ID, not by email. An account can have a password, a Google identity, or both. | P0 (built in Phase 1 so linking needs no data migration) |
| AUTH-12 | Google OAuth client credentials live in server environment variables (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`). The consent screen is verified for production under the `hiraia.org` domain. | P0 gate |
| AUTH-13 | The account's email domain confers nothing: no badge, no extra access, no different limits. | P0 |

**Account-linking migration for Phase 1 users**

1. **Matching, verified email.** A teacher who registered with email/password and later chooses "Continue with Google" with the same email, where Google reports the email verified *and* the Tala account's email is verified: Tala asks them to confirm by entering their Tala password once (or by a link sent to that email), then attaches the Google identity. Both methods work afterwards.
2. **Matching, unverified Tala email.** No automatic link. The existing account is treated as unproven; the teacher must complete email verification first. This prevents someone pre-registering another person's address and inheriting their Google sign-in.
3. **Different emails.** A signed-in teacher can link a Google account from Settings after re-entering their password. A Google identity can be attached to only one Tala account.
4. **Duplicate accounts.** If a teacher has already created two accounts, a guided merge is offered from Settings after proving control of both; plans, classes and community artifacts move to the surviving account and attribution is preserved.
5. **Removing a method.** A teacher can remove the password or the Google link as long as one sign-in method remains.
6. **No forced migration.** Email/password stays available after Google sign-in ships.
7. **Mobile.** A session that began with a password remains valid when Google is linked; no re-download of offline data.

### 13.4 Production gates

Production at `tala.hiraia.org` opens only when all of these hold:

1. Google sign-in and account linking shipped and tested (AUTH-9 to AUTH-12).
2. Roster and student-data processing routed to the local model or rules-only, with the cloud route blocked in production, and the privacy impact assessment complete (§12.4.1, PRIV-8).
3. DeepSeek's and Alibaba Cloud's data terms reviewed for the content that does go to them (lesson text, posted lessons).
4. Security review of auth, sync, upload parsing and the model gateway complete, with no open high-severity findings.
5. Backups and restore tested; monitoring and cost alerts live.
6. Curriculum data loaded for K–10 (all learning areas) and SHS core subjects, with the self-check and correction flow working (CUR-6 to CUR-8).
7. In-place upgrade from Tala 0.4.x verified on real phones (ACT-1 to ACT-4).

This PRD does not prescribe hosting. It requires: TLS everywhere, secrets only in environment configuration, no secrets in the repository or client bundles, and a deployment that can be rolled back.

### 13.5 Architecture

| Layer | Decision |
|---|---|
| Mobile client | Expo / React Native in the existing pnpm/Turbo monorepo, TypeScript, Hermes engine. Development and release builds, not Expo Go, because of the native modules below. |
| Web client and API | The monorepo's Next.js stack, deployed at `tala.hiraia.org`. |
| Shared code | Pure TypeScript packages used by both clients and the server: pacing engine, plan and template schemas, sync protocol, validation, the HTML print templates, i18n strings, and the Hiraia brand token file (BRAND-2). This is what makes PACE-2 and PDF-4 hold. |
| Interface components | A small set of plain components (button, list row, text field, sheet, banner) built on the tokens. No heavy UI framework, charting library or animation library on the phone. Each added dependency is weighed against the size budget in §14.1. |
| Web rendering | Pages are server-rendered so the first screen is readable before scripts finish loading on a slow phone. The web app is also the fallback for a phone that cannot install the APK. |
| Local storage (mobile) | SQLite, encrypted at rest. |
| PDF on device | The shared HTML print template rendered to PDF by the platform print service; no network. |
| Activity collection | A native Android module wrapping Nearby Connections, ported from the Kotlin 0.4.x code, exposed to the app through an Expo config plugin. The 0.4.x database is migrated on first launch (ACT-2). |
| App updates | JS-only fixes delivered over the air using the signed-update mechanism the Hiraia student app already uses; checked on Wi-Fi, applied at next launch, never forced while offline. Native changes ship as a new APK. |
| Model gateway | Server-side only (§9.1). |

Risks to test in Phase 1, before the mobile build is committed to: cold start and editor latency on the 2 GB reference device, and APK size (§14.1).

---

## 14. Non-functional requirements

### 14.1 Lightweight: hard budgets for low-end Android

**Reference device:** Android 8.0, 2 GB RAM, 16–32 GB storage with little free, entry-level quad-core chipset, 5-inch 720p screen. Every target below is measured on this class of phone with the Expo/React Native release build (Hermes), not on a developer's device. Midrange phones must be better, never different.

These are release gates. Size and bundle budgets are checked automatically on every build; a build over budget does not ship.

| Budget | Hard limit | Aim |
|---|---|---|
| APK download, per architecture (including the 0.4.x card catalog) | ≤ 40 MB | ≤ 30 MB |
| Installed size before any user data | ≤ 90 MB | ≤ 70 MB |
| JavaScript bundle (Hermes bytecode) | ≤ 6 MB | ≤ 4 MB |
| Bundled fonts | One file (Fraunces SemiBold, 73 KB) | |
| Bundled images and illustrations, total | ≤ 1 MB, vector where possible | |
| Cold start to a usable This Week screen, with local data | ≤ 3 s | ≤ 2 s |
| Warm start | ≤ 1 s | |
| Open a lesson from the list | ≤ 1 s | |
| Response to a tap (visible feedback) | ≤ 100 ms | |
| Typing in the editor | No visible lag in a 3,000-word plan | |
| Scrolling | Lists virtualised; no visible stutter in a term-long list | |
| Memory in normal use | ≤ 250 MB | ≤ 180 MB |
| Memory at peak (PDF export, roster import) | ≤ 350 MB | |
| PDF export, one-week DLL | ≤ 10 s, with Cancel | |
| Local data for one school year, text only, with curriculum pack | ≤ 50 MB | ≤ 30 MB |
| Over-the-air update download | ≤ 5 MB, Wi-Fi by default | |
| Mobile data in a normal week, data saver on | ≤ 1 MB | |
| Battery | Sync is opportunistic; no persistent wake locks; Nearby collection runs only while open | |

**Asset and payload budgets**

| Item | Limit |
|---|---|
| Photo attached to a lesson | Resized on the phone to at most 1600 px on the long edge and about 300 KB before upload |
| Thumbnail | ≤ 20 KB |
| Any single API response | ≤ 100 KB compressed |
| List pages (lessons, community results, curriculum) | 20 items per page, loaded as the teacher scrolls; never an unbounded list |
| Community search results | Capped at 200 per query; the teacher narrows with filters |
| Roster | 500 rows per class |
| Web first load, critical path | ≤ 300 KB compressed script; first screen readable within 5 s on a slow 3G connection |
| Web page total, first visit | ≤ 600 KB |

**When the phone itself is the constraint**

- **Low memory:** the app drops cached screens and images first; never the text being edited. The editor saves on every pause, so a system kill loses nothing.
- **Low storage:** before storage runs out, the app says so in plain words, stops downloading attachments and older lessons, and keeps this week's lessons and all unsent work. It never deletes unsent work to make room.
- **Old or failing hardware features:** no feature depends on the camera, GPS, biometric unlock or a notch-free screen. Activity collection needs Bluetooth and Android 10; without them it is shown as unavailable and everything else works.
- **Slow phone:** no animation is required for understanding, and none delays an action.

If the React Native build cannot meet the cold-start, memory or editor targets on the reference device in Phase 1 testing, that is raised to Luis before Phase 2 begins (§19, item 12).

### 14.2 Resilient: connectivity, fallbacks and small screens

#### 14.2.1 Degradation ladder

The app is always on one of four rungs. It moves between them by itself, says which it is on in a short plain banner, and moves back up without the teacher doing anything.

| Rung | When | What works | What the teacher sees |
|---|---|---|---|
| **1. Full** | Usable connection | Everything | Nothing special |
| **2. Low-bandwidth** | Slow, unstable or metered connection (detected from measured response times and failures, or the phone's data saver), or the teacher's own Data Saver switch | Everything, made lighter: text first, no automatic images or attachments, smaller pages, sync limited to this week and unsent work, generation and posting sent as background jobs | "Slow connection. Pictures are off to save data." |
| **3. Offline cache** | No connection | Everything on the phone: This Week, reading and writing lessons, lock and unlock, PDF, marking sessions, rescheduling, roster edits, curriculum, activity collection. Generation, posting and roster AI cleaning are accepted and queued. Community shows lessons already copied or saved. | "No connection. Your work is saved on this phone and will be sent later." |
| **4. Read-only offline** | Local changes cannot safely be accepted: storage is full, the sign-in has lapsed after long offline use (OFF-5), or the app must update before it can save in the current format | Everything saved can still be opened, read, exported to PDF and shared. Editing is paused. Unsent work is kept. | One sentence saying why and the single step that fixes it ("Connect to the internet once to sign in again") |

Rules: no rung loses data; a rung never drops to a blank screen or a sign-in wall while saved lessons exist on the phone; rung 4 is the floor, and the teacher can always read and print what they have.

#### 14.2.2 Network behaviour

| ID | Requirement | Pri |
|---|---|---|
| RES-1 | **Saved data first.** Every screen draws from local storage immediately and refreshes in the background (OFF-1). | P0 |
| RES-2 | **Placeholders, not spinners.** While something loads, the screen shows its layout with grey placeholder rows, and any saved or partial content as soon as it exists. | P0 |
| RES-3 | **No blocking spinner without Cancel.** Any wait longer than one second shows what is happening and a Cancel or "Continue in background". No wait is modal for more than ten seconds. | P0 |
| RES-4 | **Retry with backoff.** Failed requests retry automatically with increasing, randomised delays (about 1, 2, 4, 8 … up to 60 seconds), at most five tries while the teacher waits, then move to the background queue, which keeps trying whenever a connection appears. | P0 |
| RES-5 | **Safe to repeat.** Every write carries an identifier so a retried or duplicated request is applied once. | P0 |
| RES-6 | **Resumable transfers.** Uploads and downloads continue from where they stopped; a dropped connection never restarts a file or leaves a lesson half-saved (OFF-4). | P0 |
| RES-7 | **Small, patient requests.** Timeouts suit 2G-class links; requests are compressed; sync sends changes only. | P0 |
| RES-8 | **Queue, don't refuse.** Anything that needs the network and cannot run now is accepted, shown as "waiting to send", and can be cancelled. | P0 |
| RES-9 | **Plain failure messages** that say what happened, that the teacher's work is safe, and what to do; never a raw error (SIMPLE-6). | P0 |
| RES-10 | **Data saver** switch in Settings forces rung 2 and shows roughly how much data sync has used this week. | P0 |
| RES-11 | **Updates never strand the teacher.** Not forced while offline, downloaded on Wi-Fi by default, and an old version can always send its unsent work before being asked to update. A failed over-the-air update rolls back to the working version. | P0 |
| RES-12 | **Server trouble looks like bad signal.** If Tala's server or a model provider is down, the app behaves as on rung 3 for the affected features. | P0 |

#### 14.2.3 Fallback for each feature

| Feature | If it cannot run as designed | Fallback |
|---|---|---|
| Lesson generation | Offline, both providers failing, allowance used | Queue the request; offer the pre-filled template to write by hand (§9.4) |
| Section regeneration | Same | Keep the current text; queue or cancel |
| PDF | Phone cannot produce it | Retry without images → plain printable page or text → server PDF when online (PDF-4a) |
| Roster AI cleaning | Offline or model unavailable | Rules-only cleaning with the same review screen; or "import exactly as written" |
| Roster file cannot be read | Unknown format or damaged file | Paste the names as text |
| Community search | Offline or slow | Saved and copied lessons; filter-only search with text results, no thumbnails |
| Posting | Offline | Queued; visible after the check runs |
| Attachments | Slow connection or low storage | Thumbnail and file name; download on request |
| Curriculum data | Pack missing for a grade | Typed objectives (CUR-10); download when online |
| Calendar preset | Not available for a year | Blank year the teacher fills in |
| Sign-in | Offline on a phone already signed in | Stay signed in (OFF-5); activity collection needs no account (ACT-4) |
| Google sign-in | Google unreachable | Email and password |
| The app itself | Phone cannot install or run it | The web app in the phone's browser |

#### 14.2.4 Small screens

Small screens get a simpler layout, never a broken or cut-off one.

| ID | Requirement | Pri |
|---|---|---|
| SCR-1 | Fully usable at 320 dp width, and at 360 dp with the system font at 200%. Nothing requires horizontal scrolling or landscape. | P0 |
| SCR-2 | Phone layouts are a single column. Wider screens may add a second column; they do not add features. | P0 |
| SCR-3 | Tables collapse to stacked cards on a phone: the DLL week becomes a list of days, the multi-grade time-block table becomes one card per time block listing each grade group. | P0 |
| SCR-4 | Long text wraps and truncates with a way to read it all; Filipino strings, which run longer than English, are tested on the smallest width. | P0 |
| SCR-5 | The on-screen keyboard never hides the field being typed in or the Save action. | P0 |
| SCR-6 | Anything that cannot be edited comfortably on a phone is still readable there, and says it is easier on a bigger screen instead of failing. | P0 |

### 14.3 Languages

- Interface fully in **Filipino and English**, switchable at any time, with Filipino the default for new accounts on Philippine locales and English elsewhere.
- All strings externalised; no text in images. Dates, numerals and school terms follow Philippine conventions when a DepEd calendar is in use.
- Filipino interface text is written or reviewed by a fluent speaker who is also a teacher, not machine-translated and shipped.
- Content language is independent of interface language: a teacher can use the English interface and write Filipino plans.
- Curriculum text is shown in the language of the official guide; it is not translated by Tala.
- Further interface languages (Cebuano first) are P2 and are subject to the project's corpus-check rule.

### 14.4 Security and privacy

- TLS for all traffic; HSTS on `tala.hiraia.org`.
- Authorisation enforced on the server for every object: a teacher can read and write only their own classes, rosters and private plans.
- Open sign-up means the service must assume some accounts are not teachers: abuse limits on registration, posting and generation (AUTH-4), and no feature that trusts an account's self-description.
- Uploaded files are parsed in an isolated process with size, time and memory limits; spreadsheets are read as data only (no macros, formulas evaluated, or external links followed).
- Rich text is sanitised on save and on render. Model output is sanitised the same way.
- Secrets in environment variables only. Dependency and secret scanning in CI. The Android signing key and the over-the-air update signing key are kept out of the repository.
- Logs contain no plan bodies, roster content, prompts or model outputs. Analytics are aggregate and carry no student data.
- Encrypted backups with tested restore; documented retention.
- Privacy policy and terms in Filipino and English, readable on a phone, before production.
- An incident process that includes notifying affected teachers and the regulator where required.

### 14.5 Accessibility

- WCAG 2.1 AA on web; platform accessibility guidance on Android.
- All functions usable with a screen reader (TalkBack) and with a keyboard on web.
- Text scales with the system font size to 200% without loss of function.
- Touch targets at least 48 dp (SIMPLE-7). Colour is never the only carrier of state; every state also has a word or icon. Contrast meets AA from the Hiraia tokens (BRAND-5); forest on cream gives 10.4:1, which also holds up in sunlight.
- The multi-grade time-block table, with up to four group columns, has an accessible linear reading order.
- PDFs are tagged with real text and reading order.

### 14.6 Reliability and configurability

- No acknowledged save is ever lost: writes are durable locally before the interface confirms them.
- Server availability target 99.5% monthly. Because of offline-first design, an outage degrades generation and community only.
- Sync is idempotent; replays are harmless.
- **Configuration over code.** Curriculum data, calendar presets, pacing defaults, quotas, budget ceilings, model routing per feature, prompt and moderation-guideline versions, storage limits and the offline window are all changeable without a client release (Appendix B).

---

## 15. Success metrics

Measured in aggregate, without student data. Targets are for the first full school quarter after V1.0 unless stated; baselines come from the beta. Targets are themselves provisional and are revisited after beta.

| Area | Metric | Target |
|---|---|---|
| Activation | New accounts that set up a class with a timetable within 7 days | ≥ 60% |
| Any-day onboarding | Mid-year sign-ups who reach a populated timeline in their first session | ≥ 80% |
| Any-day onboarding | Teachers who change the proposed starting position (shows the estimate is being checked, and how good it is) | Tracked |
| Timeline value | Weekly active teachers who open a plan from the timeline at least once that week | ≥ 70% |
| Planning | Median locked plans per weekly active teacher per week | ≥ 3 |
| Generation quality | Generated drafts that are subsequently locked | ≥ 50% |
| Generation quality | Schema-valid on first attempt, per provider | ≥ 98% |
| Generation reliability | Requests served by the Qwen fallback; requests failing on both | Tracked; both-fail ≤ 0.5% |
| Multi-grade | Multi-grade drafts passing all §9.3 validation rules on first attempt, for 2, 3 and 4 groups separately | ≥ 95% for 2; ≥ 90% for 3 and 4 |
| Multi-grade | Share of multi-grade teachers among weekly actives who lock ≥ 1 multi-grade plan per week | ≥ 50% |
| Speed | Median time from "generate" to "lock" | ≤ 10 min |
| Offline | Mobile sessions that begin offline and complete without error | ≥ 99% |
| Offline | Sync conflicts requiring teacher choice, per 1,000 plan edits | ≤ 2 |
| Roster | Imports completed without leaving the flow | ≥ 85% |
| Roster | Rows auto-classed *clean* that the teacher later edits (proxy for silent error) | ≤ 1% |
| Community | Posted lessons copied by at least one other teacher within 30 days | ≥ 30% |
| Community | Copied lessons that are modified before being locked | Tracked |
| Moderation | Posts returned to author; returns overturned on escalation; reports that lead to removal | Tracked, used to tune the guidelines |
| Moderation | Confirmed student personal data found in a visible post | Zero; each one a guideline fix |
| Curriculum self-check | Competencies in active use that at least one teacher has checked | ≥ 80% by end of first quarter |
| Curriculum self-check | Confirmed data errors | Each published as a fix within 7 days |
| Absorbed app | 0.4.x phones upgraded with no data loss and no re-enrolment | 100% of pilot phones |
| Retention | Teachers active in week 8 after sign-up | ≥ 40% |
| Performance | Reference-device cold start at p75 | ≤ 3 s |
| Lightweight | APK size and JS bundle against the §14.1 budgets | Within budget on every release |
| Resilience | Sessions spent on each rung of the degradation ladder; sessions that ended in a blank screen, an uncancellable wait, or lost work | Tracked by rung; the last three are zero |
| Simplicity | Last-mile teachers completing each main flow unaided on their own phone (SIMPLE-13) | ≥ 4 of 5 per flow |
| Simplicity | Teachers who ever open an "Advanced" screen | Tracked; a high share means a default is wrong |
| Cost | Model cost per weekly active teacher | Within the configured budget |

---

## 16. Phased release plan

Phases are gated by exit criteria, not dates; dates, capacity and budget stay configurable. The fixed points are: demonstrable during SY 2026–2027, and Tala V1.0 in teachers' hands before SY 2027–2028 opens **[verify]** the opening date.

| Phase | Contents | Exit criteria |
|---|---|---|
| **0 — Foundations** | Shared TypeScript packages (schemas, pacing engine); Hiraia brand token file and the small component set; size and bundle budgets wired into the build; curriculum extraction tooling and first data set (proposed: Grades 1–6, all learning areas); SY 2026–2027 calendar preset; model gateway with DeepSeek → Qwen chain, prompt versioning and evaluation set; configuration service | A curriculum set loads with source links; evaluation harness runs on both providers; configuration changes apply without a deploy; canonical brand tokens confirmed by Luis |
| **1 — Alpha (staging) — demo-ready** | Email/password auth with open sign-up; classes with up to four grade groups; timetable, calendar; pacing engine, timeline and any-day onboarding; sample class; planning core; single-grade and multi-grade generation; curriculum self-check marks; web app; Expo performance spike on the reference device | Reference-phone spike meets the §14.1 start, memory and editor limits or is escalated. First unaided-teacher test (SIMPLE-13). **A mid-year demo works end to end** with the sample class: sign up, set up, see this week, generate a multi-grade plan, edit, lock. Ten invited teachers, at least three multi-grade, plan two real weeks. Multi-grade validation ≥ 90% |
| **2 — Beta (staging)** | Expo Android app with offline sync and conflict handling; lock/unlock; PDF on device and web; roster ingestion with the flagged cloud route and rules-only route; section regeneration; disruption realignment; remaining K–10 data and SHS core subjects; **absorbed activity collection and 0.4.x in-place upgrade** | All §14.1 budgets met on the reference phone; every rung of the degradation ladder and every fallback in §14.2.3 exercised in testing; a week of offline use by pilot teachers with no data loss; roster rules in §12.4 pass an adversarial test set; PDFs accepted by pilot schools' heads; upgrade from 0.4.4 verified on a real phone pair with no re-enrolment |
| **3 — Community beta** | Post, browse, search, copy, modify, lineage, BY-NC licence, LLM moderation with loose guidelines, report button, staff takedown switch | Seeded library for launch grades; no confirmed student personal data in a visible post for four weeks; moderation decisions logged and reviewed once for tuning |
| **4 — Pre-production gate** | Google sign-in and account linking; local model for roster data, cloud route blocked in production; security review; privacy assessment; backups, monitoring, cost alerts; Filipino interface review; accessibility audit; SY 2027–2028 calendar preset | All seven gates in §13.4 pass |
| **5 — Production release candidate** | Opens at `tala.hiraia.org` to anyone; staged rollout of the Android upgrade to pilot schools first; Kotlin 0.4.x retired | Four weeks in production with no data-loss incident, no open high-severity defect, metrics instrumented |
| **Tala V1.0** | Name applied | Every P0 requirement in this document shipped and verified; Luis signs off |

---

## 17. V1.0 out of scope

Not in Tala V1.0:

- School-head, supervisor or division accounts; plan submission and approval workflow inside the app
- Teacher verification of any kind, including DepEd-account badges
- Gradebook, class record, attendance, behaviour tracking, report cards
- LRN, birthdate, guardian or contact storage; any link to DepEd LIS or other DepEd systems
- Student or parent accounts; assigning or collecting student work
- Uploading or syncing classroom-activity data to the server, or showing it on the web
- **Community comments, discussion threads, ratings, direct messages, follows, collections, and school/division circles**
- Human moderation queue and response-time commitments; volunteer moderator programme; reputation or badges
- Licences other than CC BY-NC 4.0 for posted lessons
- Automated checking of a plan's curriculum alignment or factual accuracy
- **SHS electives and track/strand specialised subjects**; ALS, SPED-specific and non-DepEd curricula as preloaded data; teacher-defined competency lists
- Classes with five or more grade groups
- iOS app; desktop app
- Dark mode, themes, or any palette other than the Hiraia brand
- Free-form tables and inline images in the lesson editor; drag-and-drop planning; customisable dashboards; keyboard-shortcut workflows
- Calendar-grid views on phones; any phone layout that needs landscape or horizontal scrolling
- Decorative animation and illustration-heavy screens
- On-device lesson generation (generation requires a connection in V1.0)
- Generation or interface in Cebuano or any language other than Filipino and English
- Photo/handwriting roster import; photo timetable import
- Generated images, slides, worksheets as separate designed files, or quizzes with answer keys as a distinct product feature (a plan's assessment section is in scope)
- DOCX or Google Docs export; Google Drive, Classroom or Calendar integration
- Real-time co-editing of a plan by two teachers
- Regional contextualised curriculum content shipped by Tala
- Public, search-engine-indexed lesson pages
- Paid features, advertising, or sale of data, at any time

---

## 18. Decisions in force

### 18.1 Luis's decisions (13 November 2026)

| # | Decision | Where applied |
|---|---|---|
| 1 | Tala V1.0 **absorbs** Hiraia Tala 0.4.x | §1.1, §6.7, §13.5, §16 |
| 2 | Mobile is **Expo / React Native** | §13.1, §13.5, §14.1 |
| 3 | Cloud LLM processing of roster data is a **flagged but available** activity for now; no real production data at this stage; production goes to a **local model** | §9.8, §12.4.1, PRIV-7, PRIV-8, §13.4 |
| 4 | Senior high: **core subjects only** | CUR-1, §6.3.1, §17 |
| 5 | **Anyone can use it**; no teacher verification | §1, §3, §11.1, §13.1–13.3, PRIV-11 |
| 6 | **DeepSeek first, then Qwen on Alibaba** | §9.1, §9.6, §9.8 |
| 7 | Licence is **CC BY-NC** | §11.7 |
| 8 | Launch year **SY 2027–2028**, usable **mid-year** for demos | §7.2, §7.5, PACE-5, PACE-11, §16 |
| 9 | **Teachers self-check** curriculum and alignment | CUR-6 to CUR-9, §9.4, DOC-1 |
| 10 | **Keep it all configurable** | §7.3, §9.7, §14.6, Appendix B |
| 11 | Community: post, copy, modify; **no comments or discussion** | §11 |
| 12 | **LLM moderation, very loose guidelines** to start | §11.6 |
| 13 | **Up to four grades** in a class | §7.4, §8, §9.3, PDF-2 |
| 15 | **Keep Tala teal** in the design language: Hiraia colours are the base, Tala teal **`#2F6360`** is the accent (final) | §4.3.1, BRAND-1a |
| 14 | **Hiraia branding and colours; simplicity over sophistication; lightweight and resilient with strong fallbacks** for non-technical teachers in last-mile schools on entry-level and midrange phones | §1, §4.3, §13.5, §14.1, §14.2, §16, §18.3 |

### 18.2 Decisions I made where the brief was silent

1. **Individual teacher only.** One role. "Submitted" is a personal record, not a workflow.
2. **Pacing is deterministic and on-device.** No model is involved in deciding what is due.
3. **Term structure is data.** No hard-coded four quarters.
4. **Competencies are always extracted from the source guide and stored;** the generator is never asked to supply them, and unloaded subjects fall back to typed objectives.
5. **Lock is owner-controlled and reversible,** with history; community versions are immutable snapshots, and posting requires a locked plan.
6. **PDF is generated on device** from a print template shared with the web.
7. **Section-level versioning** for sync, with keep-both on true conflicts.
8. **Roster stores names and grade group only;** everything else is dropped at import.
9. **Community requires sign-in to browse** and is not search-indexed, though sign-up itself is open.
10. **BY-NC is the only licence offered** in V1.0, not merely the default.
11. **Ratings are deferred along with comments;** copy count is the only popularity signal.
12. **Activity data stays on the phone** and collection works without an account.
13. **Generation languages are Filipino and English only.**
14. **Account model keyed by internal ID from day one** so Google linking is additive.
15. **Environment variable names:** `DEEPSEEK_API_KEY`, `DASHSCOPE_API_KEY`, `TALA_LLM_PRIMARY_MODEL`, `TALA_LLM_FALLBACK_MODEL`, `TALA_LLM_LOCAL_ENDPOINT`, `TALA_LLM_LOCAL_MODEL`, `TALA_ROSTER_LLM_ROUTE`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`.

### 18.3 Earlier requirements changed by the design direction

Each was resolved in favour of decision 14. The lighter path is now the V1.0 requirement.

| Earlier spec | Conflict | Resolution |
|---|---|---|
| PLAN-2: rich-text editor with tables and inline images | A full rich-text editor is the heaviest client feature and the likeliest to lag on a 2 GB phone | V1.0 requires simple formatted text only; template tables are structured fields; free-form tables and inline images are P2 and web-first (PLAN-2, PLAN-2a) |
| PLAN-11: Week and Month views | Calendar grids are cramped and slow on a 5-inch screen | Phone views are plain lists by day; grids only on wide screens |
| §7.3: nine adjustable pacing parameters | Reads as power-user settings | All stay adjustable (decision 10) but behind "Advanced"; three everyday controls; defaults must be right without touching them (SIMPLE-4, SIMPLE-5) |
| §10.5: side-by-side conflict comparison | Does not fit a phone; "merge" is a technical idea | Stacked versions with three plain choices; no merge tool |
| PDF-4: on-device PDF as the only mobile path | A single path can fail on a weak phone | On-device stays the default, with a three-step fallback (PDF-4a) |
| §9.4: generation failure "reported to the teacher" | An error is a dead end | Pre-filled template and a queued request instead |
| §14.1 (Draft 2): 45 MB APK ceiling | Too heavy for last-mile data and storage | 40 MB hard limit, 30 MB aim, enforced per build |
| §14.2 (Draft 2): general offline tolerance | Fallbacks were implied, not specified | Four-rung degradation ladder, network rules RES-1 to RES-12, a fallback per feature, small-screen rules SCR-1 to SCR-6 |
| §13.5: interface libraries unspecified | Risk of a heavy UI framework | Small plain component set on brand tokens; each dependency weighed against the size budget |
| Typography: none specified; student app uses several hand-drawn faces | Bundling them costs size and readability | Fraunces SemiBold for display only; system font for everything else |
| Appendix B: many configurable parameters | Could surface as teacher settings | Hiraia-side configuration only; teacher Settings holds five items (SIMPLE-4) |

---

## 19. Assumptions to confirm, and open questions

### 19.1 Assumptions I made in applying your answers

Each is built into the document above. Say so if any is wrong.

1. **"Absorb it."** I read this as the answer to the name-collision question: Tala V1.0 takes over the 0.4.x classroom-activity app, with feature parity and in-place upgrade required for V1.0 (§6.7). I also assumed activity data stays on the phone and is not synced to the server. If you meant only that this PRD is adopted as the working spec, §6.7 and gate 7 can drop to post-V1.0 and the document otherwise stands.
2. **"Local model" in production.** I applied this to roster and student-data processing only; lesson generation stays on DeepSeek → Qwen in production. If you meant every LLM feature moves to a local model for production, §9.1 and the cost model change substantially. Either way: which local model, and on what hardware?
3. **"Core subjects only."** The question was about senior high, so K–10 keeps every learning area (your original request) and SHS gets core subjects. If you meant core subjects across all grades, tell me which K–10 areas to drop to post-V1.0.
4. **"Teachers self-check."** Curriculum data goes live labelled *not yet checked*, and teachers confirm or correct it in the app. This relaxes the earlier "verified before release" rule. Given that accuracy ranks first for Hiraia, confirm you are comfortable with unchecked competency text being visible to early users.
5. **Loose moderation, one strict category.** I kept student personal data as a hard return-to-author rule inside otherwise loose guidelines. Confirm.
6. **"Keep it all configurable."** Applied to quotas, budget ceilings, limits, model routing, pacing defaults and phase dates. No numbers are fixed in the PRD.
7. **Ratings** went out with comments (not strictly "discussion"). Say if you want a simple "useful" count back in V1.0.

### 19.2 Still open

8. **Signing key and Play.** Absorbing `com.hiraia.tala` means V1.0 must be signed with the established pilot key to upgrade in place. Is that key suitable for a Google Play listing, or does V1.0 stay APK-only like 0.4.x?
9. **Qwen variant.** Which Qwen model on Alibaba Cloud? My default is to pick by running the evaluation set on the candidates in the same price class as DeepSeek v4.1 Flash.
10. **SY 2027–2028 calendar.** The DepEd calendar order and term structure for that year are probably not published yet. Plan: ship a provisional preset and replace it by data update.
11. **Non-DepEd teachers.** With open sign-up, teachers outside DepEd get the no-preloaded-curriculum path in V1.0. Is that enough, or is a custom competency list (currently P2) wanted sooner?
12. **React Native on the reference phone.** If the Phase 1 spike misses cold start or editor latency on a 2 GB device, do you want to relax the target or revisit the stack?
13. **Abuse with open sign-up.** Open registration plus free generation invites non-teacher use of the model budget. The per-account quota and budget ceiling cover cost; do you want anything stricter?
14. *(Resolved.)* Tala teal is `#2F6360`, the website's `--teal`. The 0.4.x app's `#087A78` stays with the 0.4.x app only.
15. **Canonical cream and gold.** The brand package, the website and the student app each hold slightly different values (§4.3.1). I took `packages/brand/README.md` as canonical. Confirm, so the shared token file can be created.

---

## Appendix A — Glossary

| Term | Meaning |
|---|---|
| **MATATAG** | DepEd's revised K–10 curriculum, rolled out by grade over several school years. |
| **Competency** | A learning competency from a DepEd curriculum guide; the unit Tala paces and tags. |
| **DLL / DLP** | Daily Lesson Log / Detailed Lesson Plan, the two usual DepEd lesson-plan formats. |
| **Multi-grade class** | One teacher teaching two to four grade levels in one classroom at the same time. |
| **Grade group** | The learners of one grade level within a class. |
| **Pacing track** | The ordered schedule of competencies for one subject and one grade group of one class. |
| **Pairing** | The competencies of each grade group assigned to the same session in a multi-grade class. |
| **Self-check** | A teacher confirming, against their own guide, that a competency record is right, or that a plan meets its tags. Tala does not do either automatically. |
| **Artifact** | A plan posted to the community, with versions and lineage. |
| **Flagged activity** | A feature that is available but carries an explicit warning each time it is used (cloud AI cleaning of rosters, pre-production). |
| **Local model** | A language model hosted on Hiraia's own infrastructure, not a cloud provider's API. |
| **Activity collection** | The Tala 0.4.x feature that receives learners' Hiraia student-app activity over Nearby Connections. |
| **Degradation ladder** | The four states the app moves through as conditions worsen: full, low-bandwidth, offline cache, read-only offline (§14.2.1). |
| **Reference device** | The phone every performance target is measured on: Android 8.0, 2 GB RAM, 5-inch screen. |
| **Brand tokens** | The single shared file of Hiraia colours and fonts that web, mobile and PDF all read. |
| **LRN** | Learner Reference Number. Tala never stores it. |

## Appendix B — Configurable parameters

All changeable without a client release. Values are set during alpha and beta, not in this document. The size, speed and memory budgets in §14.1 are not configuration: they are fixed release gates.

| Area | Parameters |
|---|---|
| Model routing | Primary, fallback and local model identifiers; route per feature (cloud / local / rules / off); `TALA_ROSTER_LLM_ROUTE`; production block on the cloud roster route |
| Cost | Per-teacher daily generation and regeneration allowances; global monthly ceiling and alert threshold; cache window |
| Prompts | Active template version per feature; moderation guideline version |
| Pacing | Default buffer ratio, reserved sessions, minimum sessions per competency, default weights, pairing rule, "assumed taught" default |
| Curriculum | Data version in force per school year; how many teacher confirmations mark a record *checked*; how many matching corrections trigger review |
| Calendar | Presets per school year, including provisional ones |
| Limits | Roster file size and rows; attachment size per file and per account; grade groups per class (4) |
| Offline | Plan window kept on device; attachment download rule |
| Abuse | Registration, posting and report rate limits |
| Community | Moderation on/off per check; auto-hide on personal-data report; first-post handling |
| Roster flag | Warning text and whether the flagged cloud route is offered |
| Resilience | Thresholds for entering low-bandwidth mode; retry count and delays; page sizes; image resize limits; timeouts |

None of these is a teacher-facing setting (SIMPLE-4).
