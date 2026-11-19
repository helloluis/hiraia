'use client';
/**
 * One weekly pack: what it covers (DepEd wording, verbatim), how it was checked, the three prebuilt files, the five
 * lessons, the slides and the teacher guide, and "use for my class" (copies the lessons into the teacher's own
 * records as editable drafts; AI adaptation happens afterwards, per lesson, from the editor).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { PackDetail, PackFileKind, PackLang } from '@hiraia/tala-core/contracts';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { useRecords } from '@/data/records';
import { newId } from '@/data/ids';
import { addPackToClass, fileUrl, previewUrl, usePackDetail, usePackIndex, weekdaysFrom } from '@/data/packs';
import { Banner, Button, LinkButton, PageHeader, Placeholder, Select, Sheet, TextInput, Toast, cx } from '@/components/ui';

type Tab = 'lessons' | 'slides' | 'guide';
const PHASE: Record<string, string> = {
  activating_prior_knowledge: 'Activating prior knowledge',
  lesson_purpose: 'Establishing lesson purpose',
  developing_understanding: 'Developing and deepening understanding',
  generalization: 'Making generalizations',
  evaluating_learning: 'Evaluating learning',
};

function nextMonday(): string {
  const d = new Date();
  const add = (8 - d.getDay()) % 7 || 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + add, 12).toISOString().slice(0, 10);
}

export function PackScreen({ packId }: { packId: string }) {
  const { t, lang: uiLang } = useT();
  const { status } = useSession();
  const { index } = usePackIndex();
  const entry0 = index?.packs.find((p) => p.packId === packId);
  const preferred: PackLang = uiLang === 'fil' ? 'fil' : 'en';
  const [chosen, setChosen] = useState<PackLang | null>(null);
  const lang: PackLang = chosen ?? (entry0 && !entry0.variants[preferred].viewable && entry0.variants[preferred === 'fil' ? 'en' : 'fil'].viewable ? (preferred === 'fil' ? 'en' : 'fil') : preferred);
  const { detail, error } = usePackDetail(packId, lang);
  const [tab, setTab] = useState<Tab>('lessons');
  const [useOpen, setUseOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const toggle = (
    <div role="group" aria-label={t('lib.pack.language')} className="grid grid-cols-2 gap-2">
      {(['fil', 'en'] as const).map((l) => {
        const v = entry0?.variants[l];
        return (
          <button
            key={l}
            type="button"
            aria-pressed={lang === l}
            disabled={v ? !v.viewable : false}
            onClick={() => setChosen(l)}
            className={cx(
              'min-h-touch rounded border text-body disabled:opacity-50',
              lang === l ? 'border-2 border-talaTeal text-talaTealText font-medium bg-white' : 'border-hairline bg-white'
            )}
          >
            {t(l === 'fil' ? 'lib.pack.filipino' : 'lib.pack.english')}
          </button>
        );
      })}
    </div>
  );
  if (!detail && !error) return <Placeholder rows={6} />;
  if (!detail)
    return (
      <>
        <PageHeader title={t('lib.title')} back={{ href: '/library', label: t('lib.back') }} />
        {toggle}
        <Banner kind="warn">{error}</Banner>
      </>
    );
  const { content: p, review, entry } = detail;
  const back = `/library?grade=${p.grade}&term=${p.term}`;
  const sizeOf = (kind: PackFileKind) => entry.variants[detail.language].files.find((f) => f.kind === kind);
  const mb = (bytes: number) => (bytes / 1_048_576).toFixed(1);
  const lv = entry.variants[detail.language];
  const state = (s: string) =>
    s === 'pass' ? t('lib.pack.check.pass') : s === 'fail' ? t('lib.pack.check.fail') : s === 'issues_open' ? t('lib.pack.check.open') : t('lib.pack.check.none');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={p.title} back={{ href: back, label: t('lib.back') }} subtitle={t('lib.pack.meta', { grade: p.grade, term: p.term, week: p.week })} />
      {review.publication === 'approved' && review.teacherReview ? (
        <Banner kind="success">{t('lib.pack.approvedBanner', { reviewer: review.teacherReview.reviewer, role: review.teacherReview.role })}</Banner>
      ) : lv.status === 'needs_work' ? (
        <Banner kind="error">{t('lib.pack.needsWorkBanner')}</Banner>
      ) : (
        <Banner kind="warn">{t('lib.pack.draftBanner')}</Banner>
      )}
      {toggle}
      <p className="text-body">{p.summary}</p>

      <section aria-labelledby="dl" className="flex flex-col gap-2">
        <h2 id="dl" className="font-display text-title">{t('lib.pack.downloads')}</h2>
        {entry.variants[detail.language].files.length === 0 && <p className="text-small text-forestMuted">{t('lib.pack.notBuiltFiles')}</p>}
        <div className="grid gap-2 wide:grid-cols-3">
          {(['slides', 'guide', 'plans'] as const).map((k) => {
            const f = sizeOf(k);
            if (!f) return null;
            return (
              <a
                key={k}
                href={fileUrl(p.packId, k, detail.language)}
                download
                className="flex min-h-touch items-center justify-between gap-2 rounded border border-forest bg-white px-4 py-2 font-medium hover:bg-cream"
              >
                <span>{t(k === 'slides' ? 'lib.pack.slides' : k === 'guide' ? 'lib.pack.guide' : 'lib.pack.plans')}</span>
                <span className="text-small text-forestMuted">{t('lib.pack.size', { size: mb(f.bytes) })}</span>
              </a>
            );
          })}
        </div>
      </section>

      {status === 'signedIn' ? (
        <Button variant="primary" full onClick={() => setUseOpen(true)}>
          {t('lib.pack.use')}
        </Button>
      ) : (
        <LinkButton href="/sign-in" variant="primary" full>
          {t('lib.pack.useSignIn')}
        </LinkButton>
      )}

      <section aria-labelledby="comps" className="flex flex-col gap-2">
        <h2 id="comps" className="font-display text-title">{t('lib.pack.competencies')}</h2>
        <ul className="flex flex-col gap-2">
          {p.competencies.map((c) => (
            <li key={c.id} className="rounded border border-hairline bg-white px-3 py-2">
              <p className="italic">{c.text}</p>
              <p className="text-small text-forestMuted">
                {c.shortTitle} · {t('lib.pack.bowPage', { page: c.sourcePage })}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <div role="tablist" aria-label={t('lib.pack.tabs')} className="grid grid-cols-3 gap-2 sticky top-[var(--header-h,0px)] z-10 bg-cream py-2">
        {(['lessons', 'slides', 'guide'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cx('min-h-touch rounded border text-body', tab === k ? 'border-2 border-talaTeal text-talaTealText font-medium bg-white' : 'border-hairline bg-white')}
          >
            {t(k === 'lessons' ? 'lib.pack.tab.lessons' : k === 'slides' ? 'lib.pack.tab.slides' : 'lib.pack.tab.guide')}
          </button>
        ))}
      </div>

      {tab === 'lessons' && <Lessons detail={detail} />}
      {tab === 'slides' && <Slides detail={detail} />}
      {tab === 'guide' && <Guide detail={detail} />}

      <section aria-labelledby="checked" className="flex flex-col gap-1 rounded border border-hairline bg-white px-3 py-3">
        <h2 id="checked" className="font-display text-title">{t('lib.pack.checked')}</h2>
        <p>{t('lib.pack.check.auto', { state: state(review.autoChecks.state) })}</p>
        <p>{t('lib.pack.check.model', { model: review.modelCritique.model ?? '—', rounds: review.modelCritique.rounds, state: state(review.modelCritique.state) })}</p>
        {review.modelCritique.openIssues.length > 0 && (
          <ul className="list-disc pl-5 text-small">
            {review.modelCritique.openIssues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
        <p>{t('lib.pack.check.teacher', { state: review.teacherReview ? `${review.teacherReview.reviewer} (${review.teacherReview.role})` : t('lib.pack.check.none') })}</p>
      </section>

      {useOpen && <UseSheet detail={detail} onClose={() => setUseOpen(false)} onDone={() => setToast(t('lib.use.done'))} />}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function Lessons({ detail }: { detail: PackDetail }) {
  const { t } = useT();
  const p = detail.content;
  return (
    <div className="flex flex-col gap-3">
      {p.days.map((d) => (
        <details key={d.day} className="rounded border border-hairline bg-white px-3 py-2" open={d.day === 1}>
          <summary className="min-h-touch cursor-pointer font-medium flex items-center">
            {t('lib.pack.day', { day: d.day })}: {d.title}
          </summary>
          <p className="mt-2">{d.objective}</p>
          <p className="text-small text-forestMuted mt-1">
            {t('lib.pack.materials')}: {d.materials.join('; ')}
          </p>
          <ol className="mt-2 flex flex-col gap-2">
            {d.flow.map((f, i) => (
              <li key={i} className="border-t border-hairline pt-2">
                <p className="font-medium">
                  {PHASE[f.phase] ?? f.phase} · {t('lib.pack.minutes', { n: f.minutes })}
                </p>
                <p className="text-small">
                  <b>{t('lib.pack.teacher')}:</b> {f.teacher}
                </p>
                <p className="text-small">
                  <b>{t('lib.pack.learners')}:</b> {f.learners}
                </p>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-small">
            <b>{t('lib.pack.exit')}:</b> {d.check.question} <b>{t('lib.pack.answer')}:</b> {d.check.answer} {d.check.why}
          </p>
        </details>
      ))}
    </div>
  );
}

function Slides({ detail }: { detail: PackDetail }) {
  const { t } = useT();
  const p = detail.content;
  const hasPreviews = detail.entry.variants[detail.language].files.length > 0;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-small text-forestMuted">{t('lib.pack.slidesNote')}</p>
      <ol className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 wide:grid-cols-3">
        {p.slides.map((s, i) => (
          <li key={s.id} className="rounded border border-hairline bg-white p-2">
            {hasPreviews ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl(p.packId, i + 1, detail.language)}
                alt={t('lib.pack.slideAlt', { n: i + 1, title: s.title })}
                loading="lazy"
                width={640}
                height={360}
                className="w-full h-auto rounded-sm border border-hairline"
              />
            ) : (
              <p className="font-medium">{s.title}</p>
            )}
            <p className="text-small mt-1">
              {i + 1}. {s.title}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Guide({ detail }: { detail: PackDetail }) {
  const { t } = useT();
  const g = detail.content.guide;
  const p = detail.content;
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="font-display text-title">{t('lib.pack.bigIdea')}</h3>
        <p>{g.bigIdea}</p>
        <p className="mt-1">{g.whyItMatters}</p>
      </section>
      <section>
        <h3 className="font-display text-title">{t('lib.pack.science')}</h3>
        {g.background.map((b) => (
          <div key={b.heading} className="mt-2">
            <h4 className="font-medium">{b.heading}</h4>
            {b.paragraphs.map((x, i) => (
              <p key={i} className="mt-1">
                {x}
              </p>
            ))}
          </div>
        ))}
      </section>
      <section>
        <h3 className="font-display text-title">{t('lib.pack.misconceptions')}</h3>
        <ul className="flex flex-col gap-2 mt-2">
          {g.misconceptions.map((m) => (
            <li key={m.belief} className="rounded border border-hairline bg-white px-3 py-2">
              <p className="font-medium">“{m.belief}”</p>
              <p className="text-small">
                <b>{t('lib.pack.whatsTrue')}:</b> {m.correctIdea}
              </p>
              <p className="text-small">
                <b>{t('lib.pack.inClass')}:</b> {m.howToAddress}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="font-display text-title">{t('lib.pack.questions')}</h3>
        {g.studentQuestions.map((q) => (
          <p key={q.question} className="mt-2">
            <b>{q.question}</b> {q.answer}
          </p>
        ))}
      </section>
      <section>
        <h3 className="font-display text-title">{t('lib.pack.vocabulary')}</h3>
        <ul className="mt-2 flex flex-col gap-1">
          {g.vocabulary.map((v) => (
            <li key={v.term}>
              <b>{v.term}</b>
              {v.filipino ? ` (${v.filipino})` : ''} — {v.meaning}
            </li>
          ))}
        </ul>
      </section>
      {g.safety.length > 0 && (
        <section>
          <h3 className="font-display text-title">{t('lib.pack.safety')}</h3>
          <ul className="list-disc pl-5 mt-2">
            {g.safety.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className="font-display text-title">{t('lib.pack.assessment')}</h3>
        <ol className="mt-2 flex flex-col gap-2">
          {p.assessment.map((q) => (
            <li key={q.id} className="rounded border border-hairline bg-white px-3 py-2">
              <p className="font-medium">
                {q.id.toUpperCase()}. {q.prompt}
              </p>
              {q.choices.length > 0 && (
                <ol type="A" className="list-[upper-alpha] pl-6 text-small">
                  {q.choices.map((c, i) => (
                    <li key={i} className={q.correctChoice === i ? 'font-medium' : ''}>
                      {c}
                    </li>
                  ))}
                </ol>
              )}
              <p className="text-small">
                <b>{t('lib.pack.answer')}:</b> {q.answer}
              </p>
              <p className="text-small text-forestMuted">{q.explanation}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function UseSheet({ detail, onClose, onDone }: { detail: PackDetail; onClose: () => void; onDone: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const { engine } = useSession();
  const classes = useRecords('class');
  const assignments = useRecords('assignment');
  const live = useMemo(() => classes.items.filter((c) => !c.deletedAt).map((c) => c.data), [classes.items]);
  const [classId, setClassId] = useState<string>('');
  const cls = live.find((c) => c.id === (classId || live[0]?.id)) ?? null;
  const matching = cls?.gradeGroups.find((g) => g.grade === detail.content.grade) ?? null;
  const [groupId, setGroupId] = useState<string>('');
  const group = cls?.gradeGroups.find((g) => g.id === groupId) ?? matching ?? cls?.gradeGroups[0] ?? null;
  const [weekOf, setWeekOf] = useState(nextMonday());
  const [busy, setBusy] = useState(false);
  const assignment =
    assignments.items
      .map((a) => a.data)
      .find((a) => a.classId === cls?.id && a.learningAreaId === 'science' && (!group || a.gradeGroupIds.includes(group.id))) ?? null;

  const add = async () => {
    if (!engine || !cls || !group) return;
    setBusy(true);
    try {
      const ids = await addPackToClass({ engine, detail, cls, gradeGroupId: group.id, assignmentId: assignment?.id ?? null, weekOf, newId });
      onDone();
      onClose();
      router.push(`/lessons/${ids[0]}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('lib.use.title')}
      actions={
        cls ? (
          <Button variant="primary" full busy={busy} onClick={add} disabled={!group}>
            {t('lib.use.confirm')}
          </Button>
        ) : (
          <LinkButton href="/setup" variant="primary" full>
            {t('lib.use.setUp')}
          </LinkButton>
        )
      }
    >
      {!cls ? (
        <p>{t('lib.use.noClass')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {live.length > 1 && (
            <Select label={t('lib.use.class')} value={cls.id} onChange={(e) => setClassId(e.target.value)}>
              {live.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          {cls.gradeGroups.length > 1 && (
            <Select label={t('lib.use.group')} value={group?.id ?? ''} onChange={(e) => setGroupId(e.target.value)}>
              {cls.gradeGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {`Grade ${g.grade}`}
                </option>
              ))}
            </Select>
          )}
          {!matching && <Banner kind="warn">{t('lib.use.gradeMismatch', { grade: detail.content.grade })}</Banner>}
          <TextInput label={t('lib.use.week')} type="date" value={weekOf} onChange={(e) => setWeekOf(e.target.value)} hint={weekdaysFrom(weekOf).join(' · ')} />
          <p className="text-small text-forestMuted">{t('lib.use.note')}</p>
          <p className="text-small">
            <Link href="/lessons" className="text-talaTealText underline">
              {t('nav.lessons')}
            </Link>
          </p>
        </div>
      )}
    </Sheet>
  );
}
