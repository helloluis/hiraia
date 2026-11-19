/**
 * Printable teacher documents for a pack, as HTML and A4 PDF (headless Chromium, fonts embedded), in the pack's
 * language:
 *   - lesson plans: a week overview and five MATATAG-format day plans with signature lines;
 *   - teacher guide: the science behind the week, wrong ideas, questions, materials, safety, answer key,
 *     slide-by-slide speaker notes (the same text as the deck's notes) and sources.
 * Black text on white with small brand marks, so it prints cleanly on a school's monochrome printer (BRAND-6).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import type { PackReview, WeeklyPackContent } from '@hiraia/tala-core/contracts';
import { CHROMIUM, PKG_ROOT, REPO_ROOT } from '../paths';
import { loadInputs } from '../context';
import { LABELS, fmt } from './labels';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function css(): string {
  const font = (f: string) => pathToFileURL(resolve(PKG_ROOT, 'assets/fonts', f)).href;
  return `
@font-face { font-family: 'Fraunces'; src: url('${font('Fraunces-SemiBold.ttf')}'); font-weight: 600; }
@font-face { font-family: 'Carlito'; src: url('${font('Carlito-Regular.ttf')}'); font-weight: 400; }
@font-face { font-family: 'Carlito'; src: url('${font('Carlito-Bold.ttf')}'); font-weight: 700; }
@font-face { font-family: 'Carlito'; src: url('${font('Carlito-Italic.ttf')}'); font-style: italic; }
@page { size: A4; margin: 16mm 15mm 18mm 15mm; }
* { box-sizing: border-box; }
body { font-family: 'Carlito', sans-serif; font-size: 11.5pt; line-height: 1.38; color: #000; margin: 0; }
h1, h2, h3 { font-family: 'Fraunces', serif; font-weight: 600; line-height: 1.15; margin: 0 0 6pt; }
h1 { font-size: 22pt; } h2 { font-size: 15pt; margin-top: 16pt; border-bottom: 1.2pt solid #000; padding-bottom: 3pt; }
h3 { font-size: 12.5pt; margin-top: 10pt; }
p { margin: 0 0 6pt; } ul, ol { margin: 0 0 6pt; padding-left: 16pt; } li { margin-bottom: 2pt; }
table { width: 100%; border-collapse: collapse; margin: 4pt 0 8pt; page-break-inside: auto; }
th, td { border: 0.6pt solid #555; padding: 4pt 5pt; vertical-align: top; text-align: left; font-size: 10.5pt; }
th { background: #eee; font-weight: 700; } tr { page-break-inside: avoid; }
.meta { font-size: 10pt; color: #333; margin-bottom: 8pt; }
.box { border: 1pt solid #000; padding: 6pt 8pt; margin: 6pt 0 10pt; }
.draft { border: 2pt solid #000; padding: 6pt 8pt; font-weight: 700; margin: 6pt 0 10pt; }
.comp { font-style: italic; }
.muted { color: #444; font-size: 10pt; }
.day { page-break-before: always; }
.notes-row { display: flex; gap: 10pt; margin-bottom: 8pt; page-break-inside: avoid; }
.notes-row img { width: 62mm; border: 0.6pt solid #777; flex: none; }
.sig { display: flex; gap: 24pt; margin-top: 14pt; }
.sig div { flex: 1; border-top: 0.8pt solid #000; padding-top: 3pt; font-size: 10pt; }
.brand { display: flex; align-items: center; gap: 6pt; font-size: 9.5pt; color: #333; margin-bottom: 8pt; }
.brand svg { width: 14pt; height: 14pt; }
`;
}

function glyph(): string {
  return readFileSync(resolve(REPO_ROOT, 'packages/tala-web/public/brand/hiraia-glyph.svg'), 'utf8').replace(/#BD8928/g, '#000000');
}

function reviewBox(pack: WeeklyPackContent, review: PackReview | null): string {
  const D = LABELS[pack.language].doc;
  if (review?.publication === 'approved' && review.teacherReview) {
    const t = review.teacherReview;
    return `<div class="box"><b>${esc(fmt(D.reviewed!, { name: t.reviewer, role: t.role, date: t.at.slice(0, 10) }))}</b></div>`;
  }
  const crit = review?.modelCritique;
  return `<div class="draft">${esc(fmt(D.draft!, { critique: crit && crit.rounds ? D.draftCritique! : '' }))}</div>`;
}

function head(pack: WeeklyPackContent, kind: string): string {
  const D = LABELS[pack.language].doc;
  return `<div class="brand">${glyph()}<span>Tala · Hiraia — ${esc(kind)}</span></div>
<h1>${esc(pack.title)}</h1>
<div class="meta">Grade ${esc(pack.grade)} Science · Term ${pack.term} · Week ${pack.week} · ${esc(D.meta!)}</div>`;
}

function competencies(pack: WeeklyPackContent): string {
  const D = LABELS[pack.language].doc;
  return `<table><tr><th style="width:68%">${esc(D.competencyHead!)}</th><th>${esc(D.whereHead!)}</th></tr>${pack.competencies
    .map(
      (c) =>
        `<tr><td class="comp" lang="en">${esc(c.text)}</td><td>${esc(c.shortTitle ?? '')}<br><span class="muted">${esc(fmt(D.printedWeeks!, { from: c.weekFrom, to: c.weekTo, pos: c.position, page: c.sourcePage }))}</span></td></tr>`
    )
    .join('')}</table>`;
}

export function lessonPlansHtml(pack: WeeklyPackContent, review: PackReview | null): string {
  const L = LABELS[pack.language];
  const D = L.doc;
  const overview = `<h2>${esc(D.glance!)}</h2>${competencies(pack)}
<p><b>${esc(D.bigIdea!)}:</b> ${esc(pack.guide.bigIdea)}</p>
<table><tr><th>${esc(D.dayCol!)}</th><th>${esc(D.lessonCol!)}</th><th>${esc(D.objectiveCol!)}</th></tr>${pack.days
    .map((d) => `<tr><td>${d.day}</td><td>${esc(d.title)}</td><td>${esc(d.objective)}</td></tr>`)
    .join('')}</table>
<p class="muted">${esc(pack.timing.basis)}</p>`;
  const days = pack.days
    .map((d) => {
      const comps = pack.competencies.filter((c) => d.competencyIds.includes(c.id));
      const slideNo = (id: string) => pack.slides.findIndex((s) => s.id === id) + 1;
      const first = d.flow.flatMap((f) => f.slideIds)[0];
      const last = d.flow.flatMap((f) => f.slideIds).at(-1);
      return `<section class="day"><h2>${esc(D.day!)} ${d.day}: ${esc(d.title)}</h2>
<div class="meta">Grade ${esc(pack.grade)} Science · Term ${pack.term}, Week ${pack.week} · ${d.minutes} ${esc(D.minutes!)}</div>
<h3>${esc(D.competency!)}</h3>${comps.map((c) => `<p class="comp" lang="en">${esc(c.text)}</p>`).join('')}
<h3>${esc(D.objective!)}</h3><p>${esc(d.objective)}</p>
<h3>${esc(D.resources!)}</h3><ul>${d.materials.map((m) => `<li>${esc(m)}</li>`).join('')}${first && last ? `<li>${esc(fmt(D.slidesOfDeck!, { from: slideNo(first), to: slideNo(last) }))}</li>` : ''}</ul>
<h3>${esc(D.procedure!)}</h3>
<table><tr><th style="width:17%">${esc(D.partCol!)}</th><th style="width:6%">${esc(D.minCol!)}</th><th>${esc(D.teacherCol!)}</th><th style="width:27%">${esc(D.learnersCol!)}</th><th style="width:8%">${esc(D.slidesCol!)}</th></tr>${d.flow
        .map(
          (f) =>
            `<tr><td>${esc(L.phase[f.phase] ?? f.phase)}</td><td>${f.minutes}</td><td>${esc(f.teacher)}</td><td>${esc(f.learners)}</td><td>${f.slideIds.map(slideNo).join(', ')}</td></tr>`
        )
        .join('')}</table>
${d.expectedObservations.length ? `<h3>${esc(D.observations!)}</h3><ul>${d.expectedObservations.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
<h3>${esc(D.exit!)}</h3><p><b>${esc(D.question!)}:</b> ${esc(d.check.question)}<br><b>${esc(D.answer!)}:</b> ${esc(d.check.answer)}<br><b>${esc(D.why!)}:</b> ${esc(d.check.why)}</p>
<h3>${esc(D.differentiation!)}</h3><p><b>${esc(D.support!)}:</b> ${esc(d.support)}</p><p><b>${esc(D.extension!)}:</b> ${esc(d.extension)}</p><p><b>${esc(D.longer!)}:</b> ${esc(d.longerPeriod)}</p>
<div class="sig"><div>${esc(D.prepared!)}</div><div>${esc(D.checked!)}</div><div>${esc(D.taught!)}</div></div></section>`;
    })
    .join('');
  return `<!doctype html><html lang="${pack.language === 'fil' ? 'fil' : 'en'}"><head><meta charset="utf-8"><title>${esc(pack.title)} — ${esc(D.plans!)}</title><style>${css()}</style></head>
<body>${head(pack, D.plans!)}${reviewBox(pack, review)}${overview}${days}</body></html>`;
}

export function guideHtml(pack: WeeklyPackContent, review: PackReview | null, slideImages: Record<string, string> = {}): string {
  const D = LABELS[pack.language].doc;
  const g = pack.guide;
  const refs = new Map(loadInputs().references.map((r) => [r.id, r]));
  const refName = (id: string) => refs.get(id)?.title ?? id;
  const sec = (title: string, inner: string) => `<h2>${esc(title)}</h2>${inner}`;
  const slidesBlock = pack.slides
    .map((s, i) => {
      const img = slideImages[s.id];
      const label = s.day ? `${D.day} ${s.day}, ${D.slide!.toLowerCase()} ${i + 1}` : `${D.slide} ${i + 1}`;
      return `<div class="notes-row">${img ? `<img src="${img}" alt="${esc(D.slide!)} ${i + 1}">` : ''}<div><b>${esc(label)}: ${esc(s.title)}</b><p>${esc(s.notes)}</p></div></div>`;
    })
    .join('');
  const gens = [...new Set(pack.illustrations.map((i) => i.generator.replace(/\s*\(.*$/, '')))].join(', ') || '—';
  const html = `${head(pack, D.guide!)}${reviewBox(pack, review)}
${sec(D.thisWeek!, `${competencies(pack)}<p><b>${esc(D.bigIdea!)}.</b> ${esc(g.bigIdea)}</p><p><b>${esc(D.whyItMatters!)}.</b> ${esc(g.whyItMatters)}</p><p>${esc(pack.summary)}</p>`)}
${sec(D.science!, g.background.map((b) => `<h3>${esc(b.heading)}</h3>${b.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}${b.refIds.length ? `<p class="muted">${esc(D.see!)}: ${b.refIds.map((r) => esc(refName(r))).join('; ')}</p>` : ''}`).join(''))}
${sec(D.prereq!, `<table><tr><th>${esc(D.ideaCol!)}</th><th>${esc(D.quickCheckCol!)}</th><th>${esc(D.missingCol!)}</th></tr>${g.prerequisites.map((p) => `<tr><td>${esc(p.idea)}</td><td>${esc(p.quickCheck)}</td><td>${esc(p.ifMissing)}</td></tr>`).join('')}</table>`)}
${sec(D.words!, `<table><tr><th>${esc(D.wordCol!)}</th><th>${esc(D.filCol!)}</th><th>${esc(D.meaningCol!)}</th><th>${esc(D.exampleCol!)}</th></tr>${g.vocabulary.map((v) => `<tr><td><b>${esc(v.term)}</b></td><td>${esc(v.filipino ?? '—')}</td><td>${esc(v.meaning)}</td><td>${esc(v.example)}</td></tr>`).join('')}</table>`)}
${sec(D.wrongIdeas!, `<table><tr><th>${esc(D.thinkCol!)}</th><th>${esc(D.whyCol!)}</th><th>${esc(D.trueCol!)}</th><th>${esc(D.doCol!)}</th></tr>${g.misconceptions.map((m) => `<tr><td>${esc(m.belief)}</td><td>${esc(m.whyLearnersThinkIt)}</td><td>${esc(m.correctIdea)}</td><td>${esc(m.howToAddress)}</td></tr>`).join('')}</table>`)}
${sec(D.questions!, g.studentQuestions.map((q) => `<p><b>${esc(q.question)}</b><br>${esc(q.answer)}</p>`).join(''))}
${sec(D.local!, `<ul>${g.localExamples.map((e) => `<li><b>${esc(e.example)}.</b> ${esc(e.connection)}</li>`).join('')}</ul>`)}
${sec(D.materials!, `<table><tr><th>${esc(D.itemCol!)}</th><th>${esc(D.howMuchCol!)}</th><th>${esc(D.notesCol!)}</th><th>${esc(D.subCol!)}</th></tr>${g.materials.map((m) => `<tr><td>${esc(m.item)}</td><td>${esc(m.amount)}</td><td>${esc(m.notes)}</td><td>${esc(m.substitute ?? '—')}</td></tr>`).join('')}</table><ul>${g.preparation.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`)}
${g.safety.length ? sec(D.safety!, `<ul>${g.safety.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`) : ''}
${sec(D.daily!, pack.days.map((d) => `<h3>${esc(D.day!)} ${d.day}: ${esc(d.title)}</h3><ul>${d.expectedObservations.map((o) => `<li>${esc(o)}</li>`).join('') || `<li>${esc(D.noObs!)}</li>`}</ul><p><b>${esc(D.exit!)}:</b> ${esc(d.check.question)} <b>${esc(D.answer!)}:</b> ${esc(d.check.answer)} ${esc(d.check.why)}</p>`).join(''))}
${sec(D.assessment!, pack.assessment.map((q) => `<div style="page-break-inside:avoid"><p><b>${esc(q.id.toUpperCase())}.</b> ${esc(q.prompt)}</p>${q.choices.length ? `<ol type="A">${q.choices.map((c, i) => `<li>${esc(c)}${q.correctChoice === i ? ` <b>${esc(D.correct!)}</b>` : ''}</li>`).join('')}</ol>` : ''}<p><b>${esc(D.answer!)}:</b> ${esc(q.answer)}</p><p><b>${esc(D.explanation!)}:</b> ${esc(q.explanation)}</p></div>`).join(''))}
<h2 style="page-break-before:always">${esc(D.notes!)}</h2><p class="muted">${esc(D.notesIntro!)}</p>${slidesBlock}
${sec(D.sources!, `<ul>${g.sources.map((s) => { const r = refs.get(s.refId); return `<li>${esc(r?.title ?? s.refId)} — ${esc(r?.publisher ?? '')}. ${esc(s.locator)}. ${esc(D.usedFor!)}: ${esc(s.usedFor)}. ${r ? `<span class="muted">${esc(r.url)}</span>` : ''}</li>`; }).join('')}<li>${esc(fmt(D.bowSource!, { grade: pack.grade }))} <span class="muted">${esc(refs.get('deped-bow-science-2026')?.url ?? '')}</span></li></ul>
<p class="muted">${esc(D.citeNote!)}</p>
<p class="muted">${esc(fmt(D.artNote!, { n: pack.illustrations.length, gens }))}</p>`)}`;
  return `<!doctype html><html lang="${pack.language === 'fil' ? 'fil' : 'en'}"><head><meta charset="utf-8"><title>${esc(pack.title)} — ${esc(D.guide!)}</title><style>${css()}</style></head><body>${html}</body></html>`;
}

export async function htmlToPdf(htmlFile: string, pdfFile: string, footerLabel: string) {
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: pdfFile,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="font-size:7.5pt;width:100%;padding:0 15mm;color:#444;display:flex;justify-content:space-between;font-family:sans-serif"><span>${esc(footerLabel)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    });
  } finally {
    await browser.close();
  }
}

export function writeHtml(file: string, html: string) {
  writeFileSync(file, html);
}
