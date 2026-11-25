import type { combineEn } from './combine.en';

/**
 * Filipino strings: isang lesson plan para sa multigrade na klase, at ang pag-download bilang Word.
 *
 * DRAFT, HINDI PA NASUSURI: first drafts by the feature's author, not yet reviewed by a fluent Filipino-speaking
 * teacher (PRD §14.3). They follow the revised voice of tala-v1-demo.13 (Puwede, Subukan ulit, klase, aralin,
 * multigrade na klase, Asignatura, Petsa). Kept in this separate file so the Filipino editorial pass can revise
 * them in one place without touching anything else.
 */
export const combineFil = {
  'mg.title': 'Isang lesson plan para sa multigrade na klase',
  'mg.lead':
    'Pumili ng aralin para sa bawat baitang. Pagsasamahin ng Tala ang mga ito sa iisang lesson plan. Sabay-sabay ang simula at pagtatapos ng klase. Sa gitna, turuan ang bawat baitang nang isa-isa habang may sariling gawain ang iba. Iyo lang ang draft na ito. Puwede mong i-edit ang bawat kahon, saka i-print o i-download bilang Word file.',
  'mg.entry': 'Pagsamahin ang mga aralin para sa multigrade na klase',
  'mg.entryHint': 'Pagsamahin ang aralin ng bawat baitang sa iisang lesson plan na puwedeng i-print.',
  'mg.noClass': 'Para ito sa mga klaseng may dalawa o higit pang baitang sa iisang silid. Wala ka pang ganitong klase sa Tala.',
  'mg.noClassAction': 'Buksan ang mga klase ko',
  'mg.class': 'Klase',
  'mg.subject': 'Asignatura',
  'mg.subjectAll': 'Lahat ng baitang (walang napiling asignatura)',
  'mg.date': 'Petsa ng aralin',
  'mg.minutes': 'Tagal ng klase (minuto)',
  'mg.split': 'Magsimula nang sabay-sabay ({opening} min). Sunod ang pagtuturo mo sa bawat baitang nang isa-isa ({turns}). Magtapos nang sabay-sabay ({closing} min).',
  'mg.splitNoShared': 'Turuan ang bawat baitang nang isa-isa ({turns}).',
  'mg.lessonFor': 'Aralin para sa {grade}',
  'mg.gradeLabel': 'Baitang {grade}',
  'mg.leaveEmpty': 'Susulat na lang ako sa pinagsamang plano',
  'mg.onDate': 'sa petsang ito',
  'mg.noDate': 'walang petsa',
  'mg.noLessons': 'Wala pang naka-save na aralin para sa {grade}. Magdagdag ng pack mula sa Library o sumulat ng aralin, saka bumalik dito. Puwede mo ring iwanang blangko ito at sumulat na lang sa pinagsamang plano.',
  'mg.needOne': 'Pumili ng aralin para sa kahit isang baitang.',
  'mg.make': 'Gumawa ng pinagsamang plano',
  'mg.failed': 'Hindi nagawa ang plano. Gaya pa rin ng dati ang mga aralin mo. Subukan ulit.',
  'mg.shortTurns': 'May {groups} baitang sa {minutes} minutong klase, kaya mga {each} minuto lang ang oras mo sa bawat baitang. Puwedeng habaan ang klase o bawasan ang bilang ng baitang na tuturuan ngayong araw.',
  'mg.sources': 'Gagawa ang Tala ng hiwalay na draft. Mananatiling gaya ng dati ang mga napili mong aralin.',
  /* print and download sheet */
  'mg.print.layout': 'Layout ng multigrade na plano',
  'mg.print.table': 'Table: isang column para sa bawat baitang',
  'mg.print.stack': 'Listahan: magkakasunod ang mga bahagi ng klase',
  'mg.print.word': 'I-download bilang Word (.docx)',
  'mg.print.wordHint': 'Puwedeng i-edit ang teksto at mga table sa .docx file.',
  'mg.print.wordFailed': 'Hindi nagawa ang Word file sa device na ito.',
} satisfies Record<keyof typeof combineEn, string>;
