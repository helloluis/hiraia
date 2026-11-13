import React, { useEffect, useState } from 'react';
import { View, FlatList, ScrollView, Alert, Switch } from 'react-native';
import type {
  ArtifactSummary,
  ArtifactDetail,
  ArtifactSearchQuery,
  ReportRequest,
  Plan,
  PostArtifactRequest,
} from '@hiraia/tala-core/contracts';
import type { z } from 'zod';
import { sectionPlainText } from '@hiraia/tala-core/plan';
import { Body, Button, Field, Title, styles } from '../ui/components';
import { ContentEditor } from '../ui/ContentEditor';
import { Feedback, useAction, type FeatureProps } from './ui';
export function CommunityScreen(
  props: FeatureProps & { initialQuery?: z.input<typeof ArtifactSearchQuery> }
) {
  const { rt, t, online, canWrite } = props,
    action = useAction(t);
  const [query, setQuery] = useState<z.input<typeof ArtifactSearchQuery>>(props.initialQuery ?? {}),
    [items, setItems] = useState<ArtifactSummary[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [filters, setFilters] = useState(false),
    [detail, setDetail] = useState<ArtifactDetail | null>(null),
    [report, setReport] = useState(false),
    [reason, setReason] = useState<z.infer<typeof ReportRequest>['reason']>('personal_data'),
    [note, setNote] = useState(''),
    [classId, setClassId] = useState<string | null>(null),
    [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  async function search(more = false) {
    if (!online) {
      const saved = await rt.features.community.saved();
      setItems(
        saved.filter(
          (a) =>
            (!query.q || `${a.title} ${a.summary}`.toLowerCase().includes(query.q.toLowerCase())) &&
            (!query.grade || a.tags.grades.includes(query.grade)) &&
            (!query.language || a.tags.language === query.language)
        )
      );
      setCursor(null);
      return;
    }
    const result = await rt.features.community.search({
      ...query,
      cursor: more ? (cursor ?? undefined) : undefined,
    });
    setItems((old) => (more ? [...old, ...result.items] : result.items).slice(0, 200));
    setCursor(result.nextCursor);
  }
  useEffect(() => {
    void action.run(() => search());
    void rt.engine
      .list('class')
      .then((rows) =>
        setClasses(
          rows.filter((c) => !c.data.archived).map((c) => ({ id: c.id, name: c.data.name }))
        )
      );
  }, [rt, online]);
  async function open(id: string, versionId?: string) {
    setDetail(await rt.features.community.detail(id, online, versionId));
    setReport(false);
  }
  if (detail)
    return (
      <ScrollView contentContainerStyle={styles.pad}>
        <Title>{detail.title}</Title>
        <Body>{detail.summary}</Body>
        <Body>
          {t('authorSelfDeclared')}: {detail.authorDisplayName}
        </Body>
        {detail.authorSchool && <Body>{detail.authorSchool}</Body>}
        <Body>{detail.license}</Body>
        <Body>{t('communityCheckNotice')}</Body>
        <Body>
          {detail.copyCount} {t('copies')}
        </Body>
        <Body>{t(detail.provenance.aiDrafted ? 'aiDraft' : 'teacherShared')}</Body>
        {detail.lineage && (
          <>
            <Body>
              {t('adaptedFrom')}: {detail.lineage.title} · {detail.lineage.authorDisplayName}
            </Body>
            {detail.lineage.available ? (
              <Button
                label={t('viewSource')}
                onPress={() =>
                  void action.run(() => open(detail.lineage!.artifactId, detail.lineage!.versionId))
                }
              />
            ) : (
              <Body>{t('sourceUnavailable')}</Body>
            )}
          </>
        )}
        <Feedback {...action} t={t} />
        {detail.moderation?.reasons.map((r, i) => (
          <View style={styles.card} key={i}>
            <Body>{t(`moderation_${r.category}` as never)}</Body>
            <Body>
              {r.sectionKey} · {r.excerpt}
            </Body>
          </View>
        ))}
        {detail.version.sections.map((s) => (
          <View key={s.key}>
            <Title>{t(s.key as never) ?? s.key}</Title>
            <ContentEditor t={t} editable={false} onChange={() => {}} value={s.content} />
          </View>
        ))}
        {report ? (
          <>
            <Title>{t('reportPost')}</Title>
            <Body>{t('reportPrivate')}</Body>
            {(
              [
                'personal_data',
                'unsuitable',
                'copied_without_credit',
                'inaccurate',
                'spam',
                'other',
              ] as const
            ).map((key) => (
              <Button
                key={key}
                label={`${reason === key ? '✓ ' : ''}${t(`report_${key}` as never)}`}
                onPress={() => setReason(key)}
              />
            ))}
            <Field label={t('reportNote')} value={note} onChange={setNote} multiline />
            <Button
              primary
              disabled={!online || !canWrite || action.busy}
              label={t('sendReport')}
              onPress={() =>
                void action.run(async () => {
                  await rt.features.community.report(detail.id, { reason, note });
                  setReport(false);
                })
              }
            />
            <Button label={t('cancel')} onPress={() => setReport(false)} />
          </>
        ) : (
          <>
            <Body>{t('copyPrivate')}</Body>
            <Button label={t('withoutClass')} onPress={() => setClassId(null)} />
            {classes.map((c) => (
              <Button
                key={c.id}
                label={`${classId === c.id ? '✓ ' : ''}${c.name}`}
                onPress={() => setClassId(c.id)}
              />
            ))}
            <Button
              primary
              disabled={!canWrite || action.busy}
              label={t('copyLesson')}
              onPress={() =>
                void action.run(async () =>
                  props.onOpen(await rt.features.community.copy(detail, online, classId))
                )
              }
            />
            <Button label={t('reportPost')} onPress={() => setReport(true)} />
            {detail.mine && (
              <Button
                label={t('removePost')}
                disabled={!online || !canWrite}
                onPress={() =>
                  Alert.alert(t('removePost'), t('copiesRemain'), [
                    { text: t('cancel'), style: 'cancel' },
                    {
                      text: t('confirm'),
                      onPress: () =>
                        void action.run(async () => {
                          await rt.features.community.remove(detail.id);
                          setDetail(null);
                          await search();
                        }),
                    },
                  ])
                }
              />
            )}
          </>
        )}
        <Button label={t('back')} onPress={() => setDetail(null)} />
      </ScrollView>
    );
  return (
    <FlatList
      contentContainerStyle={styles.pad}
      data={items}
      initialNumToRender={20}
      maxToRenderPerBatch={20}
      windowSize={3}
      keyExtractor={(a) => a.id}
      onEndReached={() => {
        if (online && cursor && items.length < 200 && !action.busy)
          void action.run(() => search(true));
      }}
      ListHeaderComponent={
        <>
          <Title>{t('community')}</Title>
          <Body>{t('communityCheckNotice')}</Body>
          {!online && <Body>{t('savedCommunityOffline')}</Body>}
          <Feedback {...action} t={t} />
          <Field
            label={t('searchLessons')}
            value={query.q ?? ''}
            onChange={(q) => setQuery({ ...query, q })}
          />
          <Button
            primary
            label={t('searchLessons')}
            disabled={action.busy}
            onPress={() => void action.run(() => search())}
          />
          <Button label={t('filters')} onPress={() => setFilters(!filters)} />
          {filters && (
            <>
              {(
                [
                  'grade',
                  'learningAreaId',
                  'termIndex',
                  'competencyId',
                  'language',
                  'region',
                  'multigrade',
                  'maxMinutes',
                ] as const
              ).map((key) => (
                <Field
                  key={key}
                  label={t(`filter_${key}` as never)}
                  value={String(query[key] ?? '')}
                  onChange={(value) =>
                    setQuery({
                      ...query,
                      [key]:
                        value === ''
                          ? undefined
                          : ['termIndex', 'maxMinutes'].includes(key)
                            ? Number(value)
                            : value,
                    })
                  }
                />
              ))}
              <Button
                label={`${query.mine ? '✓ ' : ''}${t('myPosts')}`}
                onPress={() => setQuery({ ...query, mine: !query.mine })}
              />
            </>
          )}
        </>
      }
      ListEmptyComponent={<Body>{t('noCommunityResults')}</Body>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Title>{item.title}</Title>
          <Body>
            {item.authorDisplayName} · {item.tags.grades.join(', ')} · {item.tags.language}
          </Body>
          <Body>{item.summary}</Body>
          <Body>{t(`post_${item.status}` as never)}</Body>
          <Button label={t('view')} onPress={() => void action.run(() => open(item.id))} />
        </View>
      )}
    />
  );
}
export function PostScreen(props: FeatureProps & { plan: Plan }) {
  const { rt, t, plan, canWrite, online } = props,
    action = useAction(t);
  const [title, setTitle] = useState(plan.title),
    [summary, setSummary] = useState(''),
    [displayName, setDisplayName] = useState(''),
    [showSchool, setShowSchool] = useState(false),
    [region, setRegion] = useState(''),
    [license, setLicense] = useState(false),
    [affirmed, setAffirmed] = useState(false),
    [preview, setPreview] = useState<Awaited<
      ReturnType<typeof rt.features.community.preview>
    > | null>(null),
    [queued, setQueued] = useState(false);
  const body = (): z.infer<typeof PostArtifactRequest> => ({
    planId: plan.id,
    title,
    summary,
    displayName,
    showSchool,
    region: region || null,
    termIndex: null,
    licenseAccepted: true,
    affirmed: true,
  });
  useEffect(() => {
    void rt.engine.get('profile', 'profile').then((p) => setDisplayName(p?.data.displayName ?? ''));
  }, [rt]);
  // Any edit invalidates the reviewed public snapshot and its affirmation.
  function change(fn: () => void) {
    fn();
    setPreview(null);
    setAffirmed(false);
  }
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.pad}>
      <Title>{t('postLesson')}</Title>
      <Body>{t('postPrivacy')}</Body>
      <Body>{t('communityCheckNotice')}</Body>
      <Feedback {...action} t={t} />
      <Field label={t('title')} value={title} onChange={(v) => change(() => setTitle(v))} />
      <Field
        label={t('summary')}
        value={summary}
        multiline
        onChange={(v) => change(() => setSummary(v))}
      />
      <Field
        label={t('publicDisplayName')}
        value={displayName}
        onChange={(v) => change(() => setDisplayName(v))}
      />
      <Field
        label={t('filter_region')}
        value={region}
        onChange={(v) => change(() => setRegion(v))}
      />
      <Body>{t('showSchool')}</Body>
      <Switch
        accessibilityLabel={t('showSchool')}
        value={showSchool}
        onValueChange={(v) => change(() => setShowSchool(v))}
      />
      <Button
        primary={!preview}
        disabled={!canWrite || action.busy || title.trim().length < 3 || !displayName.trim()}
        label={t('previewPublic')}
        onPress={() =>
          void action.run(async () => {
            setPreview(await rt.features.community.preview(body()));
          })
        }
      />
      {preview && (
        <>
          <Title>{t('publicPreview')}</Title>
          <Title>{preview.title}</Title>
          <Body>{preview.summary}</Body>
          <Body>
            {preview.authorDisplayName} · {preview.authorSchool}
          </Body>
          <Body>
            {plan.grades.join(', ')} · {plan.subjectName} · {plan.language} · {plan.durationMinutes}
          </Body>
          {plan.lineage && (
            <Body>
              {t('adaptedFrom')}: {plan.lineage.title} · {plan.lineage.authorDisplayName}
            </Body>
          )}
          {preview.publicContent.sections.map((section) => (
            <View style={styles.card} key={section.key}>
              <Title>{t(section.key as never) ?? section.key}</Title>
              <Body>{sectionPlainText(section.content)}</Body>
            </View>
          ))}
          {preview.findings.map((finding, i) => (
            <View style={styles.card} key={i}>
              <Body>{t(`finding_${finding.kind}` as never)}</Body>
              <Body>
                {finding.sectionKey} · {finding.excerpt}
              </Body>
            </View>
          ))}
          <Body>{t('licenseNotice')}</Body>
          <Switch
            accessibilityLabel={t('licenseNotice')}
            value={license}
            onValueChange={setLicense}
          />
          <Body>{t('affirmWork')}</Body>
          <Switch
            accessibilityLabel={t('affirmWork')}
            value={affirmed}
            onValueChange={setAffirmed}
          />
          <Body>{t('copiesRemain')}</Body>
          {!queued && (
            <Button
              primary
              label={t(online ? 'postLesson' : 'queuePost')}
              disabled={!canWrite || action.busy || !license || !affirmed || preview.blocked}
              onPress={() =>
                Alert.alert(t('postLesson'), t('copiesRemain'), [
                  { text: t('cancel'), style: 'cancel' },
                  {
                    text: t('confirm'),
                    onPress: () =>
                      void action.run(async () => {
                        await rt.features.community.post(body());
                        setQueued(true);
                        void rt.features.tick(online);
                      }),
                  },
                ])
              }
            />
          )}
        </>
      )}
      {queued && <Body>{t('postQueued')}</Body>}
      <Button label={t('back')} onPress={props.onBack} />
    </ScrollView>
  );
}
