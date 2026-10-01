'use client';

import { useMemo, useState } from 'react';

import { Wordmark } from '@/components/brand/Wordmark';
import { SiteFooter } from '@/components/SiteFooter';
import { topicMatches, type CompetencyCatalogue } from '@/data/competencies';

import styles from './Competencies.module.css';

const number = (value: number) => value.toLocaleString('en');

export function Competencies({ catalogue }: { catalogue: CompetencyCatalogue }) {
  const [grade, setGrade] = useState(String(catalogue.grades[0]?.grade ?? 'all'));
  const [quarter, setQuarter] = useState('all');
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState<'en' | 'tl' | 'bis'>('en');
  const [expanded, setExpanded] = useState(false);
  const groups = useMemo(
    () =>
      catalogue.grades
        .filter((entry) => grade === 'all' || String(entry.grade) === grade)
        .flatMap((entry) =>
          entry.quarters
            .filter((group) => quarter === 'all' || String(group.quarter) === quarter)
            .map((group) => ({
              ...group,
              grade: entry.grade,
              topics: group.topics.filter((topic) => topicMatches(topic, query)),
            }))
        )
        .filter((group) => group.topics.length),
    [catalogue, grade, quarter, query]
  );
  const resultTopics = groups.flatMap((group) => group.topics);
  const resultCompetencies = new Set(
    resultTopics.flatMap((topic) => topic.competencies.map((entry) => entry.code))
  ).size;
  const clearFilters = () => {
    setGrade('all');
    setQuarter('all');
    setQuery('');
    setExpanded(false);
  };

  return (
    <div className={`mc min-h-screen w-full ${styles.page}`}>
      <a className={styles.skipLink} href="#competency-results">
        Skip to competencies
      </a>
      <header className="px-5 pt-10 sm:px-12 sm:pt-12 md:px-16 lg:px-24">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
          <a
            href="/"
            aria-label="Hiraia homepage"
            className="font-slab text-2xl tracking-wide sm:text-3xl"
          >
            <Wordmark />
          </a>
          <nav aria-label="Page navigation" className="flex flex-wrap gap-5 text-sm">
            <a href="/faq" className={styles.boardLink}>
              Questions
            </a>
            <a href="/#download" className={styles.boardLink}>
              Get Hiraia
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className="px-5 pb-10 pt-12 sm:px-12 sm:pt-16 md:px-16 lg:px-24">
          <div className="mx-auto max-w-5xl">
            <p className="mc-label text-[10px] text-[var(--gold)]">Philippines · MATATAG Science</p>
            <h1 className="mt-3 max-w-3xl text-4xl leading-tight sm:text-5xl">
              Science competencies
            </h1>
            <p className="mt-5 max-w-3xl text-lg leading-relaxed text-[var(--stock)]/90 sm:text-xl">
              Explore the learning goals behind Hiraia&apos;s lessons. Follow the same grade,
              quarter and topic order as the app, then open a topic to see its competencies.
            </p>
            <dl className={styles.stats} aria-label="Curriculum content">
              <div>
                <dt>Grade levels</dt>
                <dd>{catalogue.counts.grades}</dd>
              </div>
              <div>
                <dt>Lesson topics</dt>
                <dd>{number(catalogue.counts.topics)}</dd>
              </div>
              <div>
                <dt>Mapped competencies</dt>
                <dd>{number(catalogue.counts.mappedCompetencies)}</dd>
              </div>
            </dl>
            <p className="mt-6 max-w-3xl text-base leading-relaxed text-[var(--stock)]/85">
              Cards and practice questions support these learning goals. Experiments, projects and
              teacher assessment are still needed; a listed competency does not mean a learner has
              mastered it.
            </p>
          </div>
        </section>

        <section aria-label="Find competencies" className={styles.filterSection}>
          <div className="mx-auto max-w-5xl">
            <fieldset>
              <legend className={styles.label}>Choose a grade</legend>
              <div className={styles.grades}>
                <button
                  type="button"
                  aria-pressed={grade === 'all'}
                  onClick={() => setGrade('all')}
                >
                  All grades
                </button>
                {catalogue.grades.map((entry) => (
                  <button
                    key={entry.grade}
                    type="button"
                    aria-pressed={grade === String(entry.grade)}
                    onClick={() => setGrade(String(entry.grade))}
                  >
                    Grade {entry.grade}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className={styles.filters}>
              <label className={styles.search}>
                <span className={styles.label}>
                  Search {grade === 'all' ? 'all grades' : `Grade ${grade}`}
                </span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setExpanded(Boolean(event.target.value.trim()));
                  }}
                  placeholder="Try water, electricity, or G3-M-1"
                  aria-controls="competency-results"
                />
              </label>
              <label>
                <span className={styles.label}>Quarter</span>
                <select
                  aria-label="Quarter"
                  value={quarter}
                  onChange={(event) => setQuarter(event.target.value)}
                >
                  <option value="all">All quarters</option>
                  {[1, 2, 3, 4].map((value) => (
                    <option key={value} value={value}>
                      Quarter {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className={styles.label}>Topic titles</span>
                <select
                  aria-label="Topic titles"
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as typeof language)}
                >
                  <option value="en">English</option>
                  <option value="tl">Tagalog</option>
                  <option value="bis">Cebuano</option>
                </select>
              </label>
            </div>
            <p className="mt-3 text-sm text-[var(--graph)]">
              Competency statements remain in the curriculum guide&apos;s English.
            </p>
          </div>
        </section>

        <section
          id="competency-results"
          aria-label="Competency results"
          tabIndex={-1}
          className="px-5 py-9 sm:px-12 md:px-16 lg:px-24"
        >
          <div className="mx-auto max-w-5xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="text-base text-[var(--stock)]/90"
              >
                {number(resultTopics.length)} {resultTopics.length === 1 ? 'topic' : 'topics'} ·{' '}
                {number(resultCompetencies)}{' '}
                {resultCompetencies === 1 ? 'competency' : 'competencies'}
                {grade !== 'all' && ` in Grade ${grade}`}
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <button
                  type="button"
                  className={styles.boardLink}
                  aria-expanded={expanded}
                  aria-controls="competency-results"
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? 'Collapse topics' : 'Expand topics'}
                </button>
                {(grade !== 'all' || quarter !== 'all' || query) && (
                  <button type="button" className={styles.boardLink} onClick={clearFilters}>
                    Show everything
                  </button>
                )}
              </div>
            </div>

            {!groups.length ? (
              <div className={styles.empty}>
                <h2 className="text-2xl">No matching topics</h2>
                <p className="mt-3">
                  Try another phrase, a different quarter, or search all grades.
                </p>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-4 underline underline-offset-4"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="mt-8 flex flex-col gap-12">
                {groups.map((group) => (
                  <section
                    key={`${group.grade}-${group.quarter}`}
                    aria-labelledby={`grade-${group.grade}-quarter-${group.quarter}`}
                  >
                    <p className="mc-label text-[10px] text-[var(--gold)]">
                      Grade {group.grade} · Quarter {group.quarter}
                    </p>
                    <h2
                      id={`grade-${group.grade}-quarter-${group.quarter}`}
                      className="mb-5 mt-2 text-2xl sm:text-3xl"
                    >
                      {group.domain}
                    </h2>
                    <div className="flex flex-col gap-3">
                      {group.topics.map((topic) => (
                        <details
                          key={`${topic.key}-${expanded}`}
                          className={`mc-faq ${styles.topic}`}
                          open={expanded}
                        >
                          <summary>
                            <span className="mc-faq-q">
                              <span
                                className={styles.topicTitle}
                                lang={language === 'tl' ? 'fil' : language === 'bis' ? 'ceb' : 'en'}
                              >
                                {topic.title[language] || topic.title.en}
                              </span>
                              <span className={styles.topicCounts}>
                                {topic.competencies.length}{' '}
                                {topic.competencies.length === 1 ? 'competency' : 'competencies'} ·{' '}
                                {number(topic.cardCount)} cards · {number(topic.questionCount)}{' '}
                                practice questions
                              </span>
                            </span>
                            <span className="mc-faq-mark" aria-hidden="true" />
                          </summary>
                          <div className={styles.topicBody}>
                            <p className={styles.competencyIntro}>The learner should be able to:</p>
                            <ul className={styles.competencyList}>
                              {topic.competencies.map((competency) => (
                                <li key={competency.code}>
                                  <p className={styles.competencyText}>{competency.text}</p>
                                  <p className={styles.competencyMeta}>
                                    <span title="Hiraia reference identifier">
                                      {competency.code}
                                    </span>
                                    <span>
                                      {number(competency.cardCount)} directly assigned cards ·{' '}
                                      {number(competency.questionCount)} practice questions
                                    </span>
                                  </p>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </details>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </section>

        <section
          aria-labelledby="about-the-map"
          className="px-5 pb-14 pt-4 sm:px-12 md:px-16 lg:px-24"
        >
          <div className={`mx-auto max-w-5xl ${styles.about}`}>
            <h2 id="about-the-map" className="text-2xl">
              About this map
            </h2>
            <div className="mt-4 grid gap-5 text-base leading-relaxed md:grid-cols-2 md:gap-10">
              <div>
                <p>
                  The reference is the <a href={catalogue.source.url}>{catalogue.source.title}</a>,{' '}
                  {catalogue.source.edition}. Hiraia has lessons mapped to{' '}
                  {catalogue.counts.mappedCompetencies} of the{' '}
                  {catalogue.counts.referenceCompetencies} competencies in this reference. Topic
                  titles and groupings follow Hiraia&apos;s app.
                </p>
                <p className="mt-3">
                  Schools may use a different curriculum edition or teaching sequence. Check the
                  programme your school follows.
                </p>
              </div>
              <div>
                <p>
                  Topic counts include related examples. The smaller counts beside each competency
                  include only cards assigned to its learning objectives. Resources can support more
                  than one competency, so counts should not be added together.
                </p>
                <p className="mt-3">{catalogue.source.identifiers}</p>
                <a href="/competencies/ph-matatag.json" download className="mt-3 inline-block">
                  Download the competency map (JSON)
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
