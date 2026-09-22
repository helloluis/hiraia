/**
 * Public FAQ — the source of truth for /faq and, later, the on-page assistant.
 *
 * HOW TO UPDATE WHEN SOMETHING SHIPS
 *  1. Numbers and flags (released?, Android version, RAM, APK URL) are NOT restated
 *     here. Read them from `@/config/download` and `@/config/grades`.
 *  2. Prepend a line to FAQ_SHIPPED for anything a visitor would notice, and point
 *     `faqIds` at the items you added or rewrote.
 *  3. Do that in the same change that ships the feature — landing copy and FAQ
 *     answers must not disagree.
 *  4. Do not invent device support, store listings, or DepEd endorsement.
 */

import { DOWNLOAD } from '@/config/download';
import { DEFAULT_GRADE, GRADE_OPTIONS } from '@/config/grades';
import talaManifest from '@/config/tala-download.json';

const APK_LIVE = DOWNLOAD.released && !!DOWNLOAD.apk.url;
const TALA = talaManifest.app;
const TALA_LIVE = !!TALA?.url;
const GRADE_SPAN = `Grades ${GRADE_OPTIONS[0]} through ${GRADE_OPTIONS[GRADE_OPTIONS.length - 1]}`;
const FIRST_FETCH = `about ${DOWNLOAD.modelDownloadGB}GB`;

/** Newest first. The "What's new?" item and the assistant read this. */
export const FAQ_SHIPPED: readonly { date: string; title: string; faqIds: readonly string[] }[] = [
  {
    date: '2026-09',
    title: TALA_LIVE
      ? `Tala v${TALA.versionName} is the teacher companion — download it from the homepage, on a separate phone from Hiraia.`
      : 'Tala is Hiraia’s teacher companion for classroom activity on a nearby phone.',
    faqIds: [
      'tala-what',
      'tala-download',
      'tala-join',
      'tala-code',
      'tala-offline',
      'tala-phones',
      'tala-privacy',
      'tala-records',
      'trouble-tala',
    ],
  },
  {
    date: '2026-09',
    title: `Android ${DOWNLOAD.minAndroid} and newer are now supported.`,
    faqIds: ['devices-android', 'devices-tablet', 'trouble-install'],
  },
  {
    date: '2026-09',
    title: `Android APK v${DOWNLOAD.version} is public — download it from the homepage, not the Play Store.`,
    faqIds: ['usage-now', 'devices-sideload', 'trouble-download'],
  },
  {
    date: '2026-09',
    title: 'A class can copy the model over school or municipal Wi-Fi with Pears, once one phone has a complete copy.',
    faqIds: ['usage-class', 'devices-data'],
  },
];

export type FaqSectionId = 'usage' | 'tala' | 'devices' | 'content' | 'troubleshooting';

export interface FaqSection {
  id: FaqSectionId;
  label: string;
  blurb: string;
}

export interface FaqItem {
  id: string;
  section: FaqSectionId;
  q: string;
  /** One or more paragraphs. */
  a: string[];
}

export const FAQ_SECTIONS: readonly FaqSection[] = [
  {
    id: 'usage',
    label: 'Using Hiraia',
    blurb: 'How the tutor works, what a session looks like, and what is free.',
  },
  {
    id: 'tala',
    label: 'Tala for teachers',
    blurb: 'The classroom companion on the teacher’s phone, Nearby collection, and class records.',
  },
  {
    id: 'devices',
    label: 'Phones and installs',
    blurb: 'Android requirements, the first-run download, and sharing a copy in class.',
  },
  {
    id: 'content',
    label: 'Science content',
    blurb: 'MATATAG science, languages, grades, and what Hiraia will not do.',
  },
  {
    id: 'troubleshooting',
    label: 'Troubleshooting',
    blurb: 'Install blocks, stuck downloads, slow phones, and missing topics.',
  },
];

export const FAQ_ITEMS: readonly FaqItem[] = [
  // ── usage ──────────────────────────────────────────────────────────────
  {
    id: 'usage-what',
    section: 'usage',
    q: 'What is Hiraia?',
    a: [
      'Hiraia is a free AI science tutor for Filipino students. It runs on the phone itself — not in the cloud — and is built to reinforce what is being focused on at school, at home, without an internet connection.',
      'The tutor speaks Tagalog and English (Bisaya is in the same build). After a one-time download it keeps working offline, with no account and no personal data leaving the device.',
    ],
  },
  {
    id: 'usage-now',
    section: 'usage',
    q: 'Can I use it today?',
    a: APK_LIVE
      ? [
          `Yes. The Android app is on the homepage as “Download Hiraia for Android” (v${DOWNLOAD.version}). It is an APK from hiraia.org, not the Play Store. You can also try the cards in the browser with “Try the demo” before you install.`,
          `The first time you open the app it fetches ${FIRST_FETCH} — the model and related files. After that it runs offline. The project is still early alpha, so expect rough edges.`,
        ]
      : [
          'The Android app is in early alpha and the public download is marked Coming soon. You can try the tutor in the browser from the homepage: open “Try the demo,” pick a language and a grade, and walk a stack of science cards.',
          'The web demo is a preview. The full tutor — the on-device model, the illustrations, and the fact bank — ships in the Android app when v0.1 is released.',
        ],
  },
  {
    id: 'usage-whats-new',
    section: 'usage',
    q: "What's new?",
    a: FAQ_SHIPPED.map((s) => `${s.date} — ${s.title}`),
  },
  {
    id: 'usage-session',
    section: 'usage',
    q: 'How does a session work?',
    a: [
      'Hiraia is a stack of flash cards, not a chat window. Each card carries one science fact and one illustration. After a few cards, a short quiz checks whether the fact stuck; a recap card then gathers what was just read. The homepage demo walks that same loop: pick Tagalog, English, or Bisaya and a grade from 3 through 10, then the first-quarter cards for that grade in curriculum order.',
      'If a student asks for a topic that is not already in the deck, Hiraia can print a new card from its fact bank — in Tagalog, English, or Bisaya — instead of sending the question to the internet.',
    ],
  },
  {
    id: 'usage-offline',
    section: 'usage',
    q: 'Does it need the internet?',
    a: [
      `Only for the first fetch. The first time you open the app it downloads ${FIRST_FETCH} — the customized AI model and related files — from Hiraia’s servers. Prefer Wi-Fi; that transfer is large.`,
      'After that the tutor runs fully offline. No account, and Hiraia’s servers do not receive student names or what was typed. If a student joins Tala with a class QR, that teacher phone can receive saved names and learning activity over Nearby — still not over the internet. Sharing a finished model copy across classroom Wi-Fi is coming soon; until then each phone still fetches the model itself.',
    ],
  },
  {
    id: 'usage-account',
    section: 'usage',
    q: 'Do I need an account or a payment?',
    a: [
      APK_LIVE
        ? 'No. There is no registration, no subscription, and no in-app purchase. Download it from the homepage, share it with classmates, and use it.'
        : 'No. There is no registration, no subscription, and no in-app purchase. Download it (when the APK is released), share it with classmates, and use it.',
    ],
  },
  {
    id: 'usage-who',
    section: 'usage',
    q: 'Who is it for?',
    a: [
      'Students in Philippine elementary to junior high, roughly Grades 3 through 10, studying science. A parent or teacher can sit with the student, pick the grade, and let them walk the cards. The Hiraia app is the student’s tutor.',
      'Teachers who want a classroom view install Tala, a separate app on the teacher’s phone. Hiraia is not a replacement for a teacher, and it is not affiliated with the Department of Education.',
    ],
  },
  {
    id: 'usage-language-grade',
    section: 'usage',
    q: 'Can I change the language or the grade later?',
    a: [
      'Yes. Onboarding asks for a language (Tagalog, English, or Bisaya) and a grade. Both can be changed later from inside the tutor. The grade weights which cards are drawn and how a generated card is pitched; it does not lock the student into a single year of material.',
    ],
  },
  {
    id: 'usage-class',
    section: 'usage',
    q: 'Can a whole class use it from one download?',
    a: [
      'Copying the model from phone to phone over school or municipal Wi-Fi is coming soon (Pears). Until that ships, each phone still downloads the model itself. Use Wi-Fi for that first fetch.',
      'Watching a class while they study is a different path: that is Tala, on the teacher’s phone. Students keep using Hiraia; they do not share one Hiraia install as a classroom dashboard.',
    ],
  },

  // ── tala ───────────────────────────────────────────────────────────────
  {
    id: 'tala-what',
    section: 'tala',
    q: 'What is Tala?',
    a: [
      'Tala is Hiraia’s free teacher companion. Students keep studying in Hiraia. The teacher installs Tala on a separate Android phone, creates a class, and collects learning activity from nearby student phones — card views, quizzes, and the names saved on those phones.',
      'It is not a replacement for a teacher, not a gradebook that uploads to DepEd, and not affiliated with the Department of Education. Records stay on the teacher phone unless the teacher exports or shares them.',
    ],
  },
  {
    id: 'tala-download',
    section: 'tala',
    q: 'How do I get Tala?',
    a: TALA_LIVE
      ? [
          `From the homepage, “Download Tala v${TALA.versionName} for Android.” It is a separate APK from Hiraia, also from hiraia.org, not the Play Store. The file is ${TALA.url}. Android will ask you to allow a sideloaded install; that is expected.`,
          'If Tala is already on the phone, update it without uninstalling so classes and records stay put.',
        ]
      : [
          'Tala will be posted on the homepage next to the Hiraia download, as its own APK from hiraia.org, not the Play Store.',
        ],
  },
  {
    id: 'tala-join',
    section: 'tala',
    q: 'How do students join a class?',
    a: [
      'On Tala, enter the teacher name for that class and tap Show QR Code. Wait until the screen says Nearby ready. On each student phone, open Hiraia, go to settings, and choose Join Hiraia Tala / Scan teacher QR.',
      'One QR belongs to the whole class. Students do not pick a group. After phones have joined, the teacher assigns groups on Tala if needed. The QR does not change when groups are created or students are moved.',
    ],
  },
  {
    id: 'tala-code',
    section: 'tala',
    q: 'What if a student’s camera cannot read the QR?',
    a: [
      'Tala can show a temporary 12-character code (XXXX-XXXX-XXXX) while that class is collecting. On Hiraia, choose Enter code instead and type it. The code works only while Tala is collecting that class and expires after one hour. Refresh QR Code on Tala rotates the backup code; the class QR itself stays the same.',
    ],
  },
  {
    id: 'tala-offline',
    section: 'tala',
    q: 'Does Tala need the internet?',
    a: [
      'Not for collecting a class. Transfers use Google Nearby Connections over Bluetooth and Wi-Fi radios in the same room. Keep both apps in the foreground, phones unlocked, Bluetooth and Wi-Fi on. There is no pairing list and no remote collection over mobile data.',
      'Internet is only for later extras: sending an issue report, or sharing an exported spreadsheet from the teacher phone. Collection itself does not upload student activity to Hiraia’s servers.',
    ],
  },
  {
    id: 'tala-phones',
    section: 'tala',
    q: 'Can Hiraia and Tala run on the same phone?',
    a: [
      `Both need Android ${DOWNLOAD.minAndroid} or newer. Tala also needs Google Play services. Install Tala on the teacher’s phone and Hiraia on each student’s phone.`,
      'Do not run both apps on one device for a class. Nearby cannot move activity between Hiraia and Tala on the same phone.',
    ],
  },
  {
    id: 'tala-privacy',
    section: 'tala',
    q: 'What does the teacher see, and who else sees it?',
    a: [
      'After a student joins, Tala can show saved profile names and learning activity from that phone: card views (every view, and unique cards), quizzes, and related events. A tile lights up while that phone is connected.',
      'Hiraia’s online service still does not receive those names. Activity reaches Tala only after a QR or class code join, encrypted for that teacher phone. Share an export only with people you trust — the spreadsheet includes names and event details.',
    ],
  },
  {
    id: 'tala-records',
    section: 'tala',
    q: 'Can I export or share class records?',
    a: [
      'Yes. Share XLSX on Tala exports the active class: class details, each learner’s totals, and stored events. Tala builds the file on the phone and opens Android’s share sheet. It is a snapshot, not an automatic upload.',
      'Issue reports (optional photos or a short video) stay on the phone until the teacher is online; Send pending reports retries them. Share report text is a text-only fallback.',
    ],
  },

  // ── devices ────────────────────────────────────────────────────────────
  {
    id: 'devices-android',
    section: 'devices',
    q: 'Which phones does it run on?',
    a: [
      `Android ${DOWNLOAD.minAndroid} or newer. Phones with ${DOWNLOAD.minRamGB}GB of memory or more are recommended for model-generated cards. The built-in flash-card library works without the model. Hiraia is built for entry-level Android handsets, not for a flagship-only audience.`,
      APK_LIVE
        ? 'There is no iPhone build, and it is not listed on the Play Store. Download the APK from the homepage on hiraia.org.'
        : 'There is no iPhone build, and it is not listed on the Play Store. When v0.1 ships it will be a single APK from hiraia.org.',
    ],
  },
  {
    id: 'devices-storage',
    section: 'devices',
    q: 'How much storage does it need?',
    a: [
      `The Hiraia app itself is a few hundred megabytes. The first time you open it, it fetches ${FIRST_FETCH} of files — the on-device model and related assets. Leave that much free space before the first launch, plus a little room for the system to unpack the files. Tala is a much smaller teacher APK and does not download that model.`,
    ],
  },
  {
    id: 'devices-first-run',
    section: 'devices',
    q: 'What happens the first time I open the app?',
    a: [
      `Hiraia looks for the model and related files. If they are not on the phone yet, it downloads about ${DOWNLOAD.modelDownloadGB}GB from Hiraia’s own servers. The transfer can resume if the connection drops. Sharing a finished copy across classroom Wi-Fi is coming soon.`,
      'When that finishes, the tutor is local. You can turn on airplane mode and keep studying.',
    ],
  },
  {
    id: 'devices-data',
    section: 'devices',
    q: 'Should I use mobile data for the first download?',
    a: [
      `Prefer Wi-Fi. ${DOWNLOAD.modelDownloadGB}GB on a cellular plan is a large bill for most families. Classroom sharing of the model over school or municipal Wi-Fi is coming soon; until then, each student phone still fetches the model itself, so that first download should not ride a cellular plan.`,
    ],
  },
  {
    id: 'devices-sideload',
    section: 'devices',
    q: 'Why isn’t it on the Play Store?',
    a: [
      'Hiraia is distributed as its own APK, outside the Play Store, so a school or a household can copy it without a Google account. Android will ask you to allow installs from the browser or from Files; that prompt is expected.',
      APK_LIVE
        ? 'Download it only from the button on hiraia.org. Do not install an APK that arrived as a random file or a third-party mirror.'
        : 'The download is not open yet — the button on the homepage still reads Coming soon. Do not install an APK that did not come from hiraia.org.',
    ],
  },
  {
    id: 'devices-tablet',
    section: 'devices',
    q: 'Will it run on a tablet or a cheap Android?',
    a: [
      `Any device running Android ${DOWNLOAD.minAndroid} or newer with enough free storage can try. Memory is the usual limit: ${DOWNLOAD.minRamGB}GB RAM is recommended for model-generated cards because the 2B on-device model has to sit in memory while it runs. The built-in flash-card library remains available without generating new cards.`,
      'If you are unsure, try the web demo first. It will not prove performance on your handset, but it will show you the cards and the quizzes.',
    ],
  },

  // ── content ────────────────────────────────────────────────────────────
  {
    id: 'content-subject',
    section: 'content',
    q: 'What subject does it teach?',
    a: [
      'Science. Hiraia is built around the Department of Education’s MATATAG science competencies for the 2027 curriculum, aimed at elementary through junior high. It is not a math tutor, not an English workbook, and not a general chatbot.',
    ],
  },
  {
    id: 'content-matatag',
    section: 'content',
    q: 'What does “MATATAG-compatible” mean?',
    a: [
      'The flash cards and illustrations are pregenerated from science competencies published for DepEd’s MATATAG curriculum. The fact bank is indexed so a student’s question can be matched to those materials and printed as a new card.',
      'Hiraia is not affiliated with or endorsed by the Department of Education. Alignment is based on public-domain curriculum information, has not been reviewed by DepEd, and is not guaranteed to be complete or up to date. Use it as a study aid, at your own risk.',
    ],
  },
  {
    id: 'content-how-much',
    section: 'content',
    q: 'How much material is in the tutor?',
    a: [
      'On the order of 50,000 science facts, 30,000 illustrations, and 20,000 mini-quizzes. A typical card is one fact plus one drawing; quizzes interrupt the walk to check memory; recap cards gather what was just read.',
    ],
  },
  {
    id: 'content-languages',
    section: 'content',
    q: 'Which languages are in the app?',
    a: [
      'Tagalog, English, and Bisaya (Cebuano), in one APK. The on-device model is a continued-pretraining fork of Qwen 3.5-2B, further trained on a Filipino and Bisaya corpus so those languages can run on the phone. Factual accuracy is ranked above perfect fluency if the two ever conflict.',
    ],
  },
  {
    id: 'content-grade',
    section: 'content',
    q: 'Which grades are covered?',
    a: [
      `${GRADE_SPAN}. The default pitch is Grade ${DEFAULT_GRADE}, because many students are behind the year printed on their ID. Changing the grade reweights which cards are drawn; it does not hide the rest of the bank.`,
    ],
  },
  {
    id: 'content-ask',
    section: 'content',
    q: 'What if the student asks something that is not on a card?',
    a: [
      'A typed question first searches the local deck. A confident match opens that card. A miss is answered from the full fact bank on the device: Hiraia retrieves related facts (indexed with LaBSE sentence embeddings) and prints a new card in the current language — or it says, honestly, that the topic is outside what a science tutor covers.',
      'It will not browse the web, and it will not invent a lesson that is not grounded in the bank.',
    ],
  },
  {
    id: 'content-homework',
    section: 'content',
    q: 'Will it do the student’s homework?',
    a: [
      'No. Hiraia is a drill-and-explain tutor: one fact, one picture, a quiz, a recap. It is meant to reinforce a lesson, not to write a report or sit the exam. If a question is off-domain, it should refuse rather than improvise.',
    ],
  },
  {
    id: 'content-status',
    section: 'content',
    q: 'How finished is the tutor?',
    a: [
      `Early alpha. The public student app is Hiraia v${DOWNLOAD.version}: cards, illustrations, quizzes, recaps, and the on-device Hiraia-2B tutor. Tala v${TALA?.versionName ?? '0.4'} is the companion teacher app. Expect rough edges, and treat answers as a study aid rather than an authority.`,
    ],
  },

  // ── troubleshooting ────────────────────────────────────────────────────
  {
    id: 'trouble-download',
    section: 'troubleshooting',
    q: 'Where do I get the APK? Is it on the Play Store?',
    a: APK_LIVE
      ? [
          `No Play Store listing. Use “Download Hiraia for Android” on the homepage. The file is ${DOWNLOAD.apk.url}. Android will warn because the app is sideloaded; that is expected. Play Protect may scan it.`,
        ]
      : [
          'No. The public APK is not released yet. Use “Try the demo” on the homepage until it is posted on hiraia.org. There is no Play Store listing to wait for.',
        ],
  },
  {
    id: 'trouble-install',
    section: 'troubleshooting',
    q: 'Android blocked the install.',
    a: [
      'Sideloaded APKs trigger a system warning. Open the prompt, allow installs from the browser or from Files for this one file, and install only an APK that came from https://hiraia.org. Play Protect may scan it; that is normal for an app that is not in the Play Store.',
      `If the phone still refuses, confirm it is Android ${DOWNLOAD.minAndroid} or newer. Older system versions are not supported.`,
    ],
  },
  {
    id: 'trouble-download-stuck',
    section: 'troubleshooting',
    q: 'The first-run download is stuck or keeps restarting.',
    a: [
      `Stay on Wi-Fi. Check that the phone has more than ${DOWNLOAD.modelDownloadGB}GB free. Leave the app open until the fetch finishes — switching away can pause some downloads. Classroom sharing of the model from a nearby phone is coming soon; until then the fetch is from Hiraia’s servers.`,
      'The transfer is built to resume. Opening the app again should continue rather than start at zero. If it loops from the beginning, clear the incomplete files by force-stopping Hiraia and retrying on a more stable network.',
    ],
  },
  {
    id: 'trouble-slow',
    section: 'troubleshooting',
    q: 'The app is slow, hot, or closes by itself.',
    a: [
      `The on-device model needs RAM. Close other apps, especially browsers and video. Phones with less than ${DOWNLOAD.minRamGB}GB of memory will struggle with generated cards; that is a hardware limit, not a setting you can flip. The built-in library still works. Lowering screen brightness and keeping the phone out of direct sun helps on long sessions.`,
      'If the app is killed as soon as a card is asked, the model likely never finished downloading. Confirm the first-run fetch completed.',
    ],
  },
  {
    id: 'trouble-offline-empty',
    section: 'troubleshooting',
    q: 'I turned off the internet and nothing loads.',
    a: [
      'Offline use starts after the first-run download has finished. If the model or the illustrations never arrived, the tutor has nothing local to open. Reconnect to Wi-Fi, launch Hiraia, and wait for that fetch to complete once. After that, airplane mode is fine.',
    ],
  },
  {
    id: 'trouble-language',
    section: 'troubleshooting',
    q: 'The cards are in the wrong language.',
    a: [
      'Change the language from the control inside the feed — it is the same three options as onboarding (Tagalog, English, Bisaya). A change should rewrite the current card and the ones after it. If a single card stays in English, that item may only have been authored in one language; skip it and keep walking.',
    ],
  },
  {
    id: 'trouble-grade',
    section: 'troubleshooting',
    q: 'The material is too hard or too easy.',
    a: [
      'Change the grade. The default is Grade 5 on purpose, because many students are behind their school year. A lower grade draws more elementary cards; a higher grade weights junior-high material more heavily. The bank still contains the rest of the years — the grade is a weight, not a wall.',
    ],
  },
  {
    id: 'trouble-search',
    section: 'troubleshooting',
    q: 'Search did not print a card for my question.',
    a: [
      'Hiraia only answers from its science fact bank. Questions about celebrities, homework in other subjects, or medical advice should be refused. If the topic is science but still misses, try a shorter query (the idea, not a full exam item) and check the language setting.',
      'A miss is not a crash. The honest “I am only a science tutor” card is the product working as designed.',
    ],
  },
  {
    id: 'trouble-demo',
    section: 'troubleshooting',
    q: 'The web demo is slow or stuck on loading.',
    a: [
      'The demo loads a large card set in the browser, then talks to Hiraia’s servers only when a typed question misses the local deck. On a slow connection, wait through the first load — later cards are local. If the loader never finishes, reload the page. The demo still needs the internet; the Android app is the offline tutor.',
    ],
  },
  {
    id: 'trouble-else',
    section: 'troubleshooting',
    q: 'None of this matches what I am seeing.',
    a: [
      'Write down the phone model, Android version, and whether the first-run download finished. The project is early alpha; rough edges are expected. Luis Buenaventura, who built Hiraia, is at x.com/helloluis. Use the feedback form on the homepage. An on-page assistant for this FAQ is next.',
    ],
  },
  {
    id: 'trouble-tala',
    section: 'troubleshooting',
    q: 'Tala is not finding student phones.',
    a: [
      'Keep Tala on Collect activity or the class QR screen until it says Nearby ready. Keep Hiraia open on each student phone. Both phones unlocked, in the same room, Bluetooth and Wi-Fi radios on — they do not need internet. Use two devices; one phone running both apps will not transfer.',
      'Allow Nearby, Bluetooth, location, and camera when Android asks. Play services must be installed for Tala. If a camera cannot read the QR, use the 12-character code while Tala is still collecting.',
    ],
  },
];

export function faqBySection(id: FaqSectionId): FaqItem[] {
  return FAQ_ITEMS.filter((item) => item.section === id);
}
