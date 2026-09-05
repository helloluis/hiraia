/**
 * Public FAQ — the source of truth for /faq and, later, the on-page assistant.
 * Keep answers concrete and in the landing's voice. Do not invent device
 * support, store listings, or curriculum endorsement that the product page
 * does not already state.
 */

export type FaqSectionId = 'usage' | 'devices' | 'content' | 'troubleshooting';

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
    a: [
      'The Android app is in early alpha and the public download is marked Coming soon. You can try the tutor in the browser from the homepage: open “Try the demo,” pick a language and a grade, and walk a stack of science cards.',
      'The web demo is a preview. The full tutor — the on-device model, the illustrations, and the fact bank — ships in the Android app when v0.1 is released.',
    ],
  },
  {
    id: 'usage-session',
    section: 'usage',
    q: 'How does a session work?',
    a: [
      'Hiraia is a stack of flash cards, not a chat window. Each card carries one science fact and one illustration. After a few cards, a short quiz checks whether the fact stuck; a recap card then gathers what was just read.',
      'If a student asks for a topic that is not already in the deck, Hiraia can print a new card from its fact bank — in Tagalog, English, or Bisaya — instead of sending the question to the internet.',
    ],
  },
  {
    id: 'usage-offline',
    section: 'usage',
    q: 'Does it need the internet?',
    a: [
      'Only for the first fetch. The first time you open the app it downloads about 2GB — the customized AI model and the illustration library — from Hiraia’s servers, or from a nearby phone that already has a complete copy.',
      'After that it runs fully offline. No account, no feed of student data, and nothing typed on the phone is sent anywhere. Curriculum updates, when you want them, can arrive over a public peer-to-peer network without a central server.',
    ],
  },
  {
    id: 'usage-account',
    section: 'usage',
    q: 'Do I need an account or a payment?',
    a: [
      'No. There is no registration, no subscription, and no in-app purchase. Download it (when the APK is released), share it with classmates, and use it.',
    ],
  },
  {
    id: 'usage-who',
    section: 'usage',
    q: 'Who is it for?',
    a: [
      'Students in Philippine elementary to junior high, roughly Grades 3 through 10, studying science. A parent or teacher can sit with the student, pick the grade, and let them walk the cards; the product is the student’s tutor, not a classroom management system.',
      'It is not a replacement for a teacher, and it is not affiliated with the Department of Education.',
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
      'That is the intended classroom path. The model is about two gigabytes, which is expensive to pull over cellular data once per student. Hiraia uses Pears, a peer-to-peer filesharing protocol: as long as one phone on the school or municipal Wi-Fi holds a complete copy, the rest of the class can take it from that phone — and from one another — without another trip to the internet.',
    ],
  },

  // ── devices ────────────────────────────────────────────────────────────
  {
    id: 'devices-android',
    section: 'devices',
    q: 'Which phones does it run on?',
    a: [
      'Android 12 or newer. Phones with 6GB of memory or more are recommended. Hiraia is built for entry-level Android handsets, not for a flagship-only audience.',
      'There is no iPhone build, and it is not listed on the Play Store. When v0.1 ships it will be a single APK from hiraia.org.',
    ],
  },
  {
    id: 'devices-storage',
    section: 'devices',
    q: 'How much storage does it need?',
    a: [
      'The app itself is a small download. The first time you open it, it fetches about 2GB of files — the on-device model and the illustration library. Leave that much free space before the first launch, plus a little room for the system to unpack the files.',
    ],
  },
  {
    id: 'devices-first-run',
    section: 'devices',
    q: 'What happens the first time I open the app?',
    a: [
      'Hiraia looks for the model and illustrations. If they are not on the phone yet, it downloads them from Hiraia’s own servers, or from any filesharing peer it finds nearby (another phone in the room that already finished). The transfer can resume if the connection drops.',
      'When that finishes, the tutor is local. You can turn on airplane mode and keep studying.',
    ],
  },
  {
    id: 'devices-data',
    section: 'devices',
    q: 'Should I use mobile data for the first download?',
    a: [
      'Prefer Wi-Fi. Two gigabytes on a cellular plan is a large bill for most families, which is why classroom sharing over school or municipal Wi-Fi exists. If one student already has a complete copy, the others should take it from that phone rather than from the internet.',
    ],
  },
  {
    id: 'devices-sideload',
    section: 'devices',
    q: 'Why isn’t it on the Play Store?',
    a: [
      'Hiraia is distributed as its own APK, outside the Play Store, so a school or a household can copy it without a Google account. Android will ask you to allow installs from the browser or from Files; that prompt is expected.',
      'The download is not open yet — the button on the homepage still reads Coming soon. Do not install an APK that did not come from hiraia.org.',
    ],
  },
  {
    id: 'devices-tablet',
    section: 'devices',
    q: 'Will it run on a tablet or a cheap Android?',
    a: [
      'Any device that is Android 12+ with enough free storage can try. Memory is the usual limit: 6GB RAM is the recommendation because the 2B on-device model has to sit in RAM while it runs. A phone that constantly kills the app is usually short on memory, not “too old.”',
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
      'Grades 3 through 10. The default pitch is Grade 5, because many students are behind the year printed on their ID. Changing the grade reweights which cards are drawn; it does not hide the rest of the bank.',
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
      'Early alpha. As of early September 2026, Hiraia is in its second round of continued pretraining and preliminary supervised fine-tuning. Cards, illustrations, and retrieval are already in the build; the on-device voice of the tutor is still being trained. Expect rough edges, and treat answers as a study aid rather than an authority.',
    ],
  },

  // ── troubleshooting ────────────────────────────────────────────────────
  {
    id: 'trouble-coming-soon',
    section: 'troubleshooting',
    q: 'The Download button says Coming soon. Is the app broken?',
    a: [
      'No. The public APK is not released yet. Use “Try the demo” on the homepage until v0.1 is posted on hiraia.org. When the download opens, it will be the same page — there is no Play Store listing to wait for.',
    ],
  },
  {
    id: 'trouble-install',
    section: 'troubleshooting',
    q: 'Android blocked the install.',
    a: [
      'Sideloaded APKs trigger a system warning. Open the prompt, allow installs from the browser or from Files for this one file, and install only an APK that came from https://hiraia.org. Play Protect may scan it; that is normal for an app that is not in the Play Store.',
      'If the phone still refuses, confirm it is Android 12 or newer. Older system versions are not supported.',
    ],
  },
  {
    id: 'trouble-download-stuck',
    section: 'troubleshooting',
    q: 'The first-run download is stuck or keeps restarting.',
    a: [
      'Stay on Wi-Fi. Check that the phone has more than 2GB free. Leave the app open until the fetch finishes — switching away can pause some downloads. If another classmate already has a complete copy on the same network, stay near them so the phone can take the files from that peer instead of from the internet.',
      'The transfer is built to resume. Opening the app again should continue rather than start at zero. If it loops from the beginning, clear the incomplete files by force-stopping Hiraia and retrying on a more stable network.',
    ],
  },
  {
    id: 'trouble-slow',
    section: 'troubleshooting',
    q: 'The app is slow, hot, or closes by itself.',
    a: [
      'The on-device model needs RAM. Close other apps, especially browsers and video. Phones with less than 6GB of memory will struggle; that is a hardware limit, not a setting you can flip. Lowering screen brightness and keeping the phone out of direct sun helps on long sessions.',
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
      'Write down the phone model, Android version, and whether the first-run download finished. The project is early alpha; rough edges are expected. Luis Buenaventura, who built Hiraia, is at x.com/helloluis. An on-page assistant for this FAQ is next.',
    ],
  },
];

export function faqBySection(id: FaqSectionId): FaqItem[] {
  return FAQ_ITEMS.filter((item) => item.section === id);
}
