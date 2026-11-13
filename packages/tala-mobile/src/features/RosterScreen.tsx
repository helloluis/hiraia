import React, { useEffect, useState } from 'react';
import { ScrollView, View, FlatList, Switch } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { decodeText, emptyName, rosterNotices, safeNameCell } from '@hiraia/tala-core/roster';
import { RosterProposed, RosterField } from '@hiraia/tala-core/contracts';
import type { Student, RosterRow } from '@hiraia/tala-core/contracts';
import type { z } from 'zod';
import type { Review } from './roster';
import { Body, Button, Field, Title, styles } from '../ui/components';
import { Feedback, useAction, type FeatureProps } from './ui';
export function RosterScreen(props: FeatureProps & { classId: string }) {
  const { rt, t, online, classId, canWrite, language } = props,
    action = useAction(t);
  const [encodingReview, setEncodingReview] = useState(false),
    [editedProposal, setEditedProposal] = useState<z.infer<typeof RosterProposed> | null>(null);
  const [text, setText] = useState(''),
    [filename, setFilename] = useState('names.txt'),
    [binary, setBinary] = useState<string | null>(null),
    [review, setReview] = useState<Review | null>(null),
    [route, setRoute] = useState<'cloud' | 'local' | 'rules' | 'off'>('rules'),
    [cloudAck, setCloudAck] = useState(false),
    [defaultGroup, setDefaultGroup] = useState<string | null>(null),
    [groups, setGroups] = useState<{ id: string; grade: string }[]>([]),
    [rowMode, setRowMode] = useState<'edit' | 'split'>('edit'),
    [editRow, setEditRow] = useState<number | null>(null),
    [edited, setEdited] = useState(''),
    [split, setSplit] = useState(''),
    [students, setStudents] = useState<Student[]>([]),
    [manual, setManual] = useState<Student | null>(null),
    [viewedChanged, setViewedChanged] = useState(false),
    [importNotice, setImportNotice] = useState(false),
    [sheet, setSheet] = useState('');
  async function refresh() {
    setReview(await rt.features.roster.load(classId));
    setStudents(
      (await rt.engine.list('student')).filter((s) => s.data.classId === classId).map((s) => s.data)
    );
  }
  useEffect(() => {
    void refresh();
    void rt.engine.get('class', classId).then((c) => {
      if (c) {
        setGroups(c.data.gradeGroups);
        setDefaultGroup(c.data.gradeGroups.length === 1 ? c.data.gradeGroups[0]!.id : null);
      }
    });
    if (online)
      void rt.client
        .call('config.get')
        .then((c) => setRoute(c.rosterLlmRoute))
        .catch(() => {});
  }, [rt, classId, online]);
  async function pick() {
    setCloudAck(false);
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const picked = result.assets[0]!;
    if ((picked.size ?? 0) > 5 * 1024 * 1024) throw Error('Too large');
    const file = new File(picked.uri);
    try {
      if (file.size > 5 * 1024 * 1024) throw Error('Too large');
      setFilename(picked.name);
      if (/\.(txt|csv|tsv)$/i.test(picked.name)) {
        const decoded = decodeText(await file.bytes());
        setText(decoded.text);
        setEncodingReview(decoded.needsReview);
        setBinary(null);
      } else {
        setBinary(await file.base64());
        setText('');
      }
    } finally {
      file.delete();
    }
  }
  async function parse(exact = false) {
    if (binary) {
      if (!online) throw Error('Paste text offline');
      setReview(
        await rt.features.roster.online({
          classId,
          filename,
          contentBase64: binary,
          useAi: false,
          exactlyAsWritten: exact,
          cloudFlagAcknowledged: false,
          sheet: sheet || undefined,
        })
      );
    } else
      setReview(await rt.features.roster.parse(classId, text, filename, exact, encodingReview));
    setText('');
    setBinary(null);
    setViewedChanged(false);
  }
  async function ai() {
    if (!online) return;
    try {
      const result = await rt.features.roster.online({
        classId,
        filename,
        ...(binary ? { contentBase64: binary } : { text }),
        sheet: sheet || undefined,
        useAi: true,
        cloudFlagAcknowledged: route === 'cloud' && cloudAck,
        exactlyAsWritten: false,
      });
      setReview(result);
      setText('');
      setBinary(null);
    } catch (error) {
      if (binary) throw error;
      setReview(await rt.features.roster.parse(classId, text, filename, false, encodingReview));
      setText('');
      setImportNotice(true);
    }
    setCloudAck(false);
  }
  async function resolve(
    row: RosterRow,
    kind: 'accept' | 'keep_original' | 'not_student' | 'edit' | 'split'
  ) {
    let list: z.infer<typeof RosterProposed>[] | undefined;
    if (kind === 'edit') list = [{ ...(editedProposal ?? row.proposed), displayName: edited }];
    if (kind === 'split')
      list = split
        .split('\n')
        .filter(Boolean)
        .map((name) => emptyName(name));
    await rt.features.roster.resolve(classId, row.rowIndex, kind, list);
    setEditRow(null);
    await refresh();
  }
  const rows =
    review?.draft.rows
      .filter((r) => !review.savedRows.includes(r.rowIndex))
      .sort(
        (a, b) =>
          (a.status === 'needs_review' ? 0 : a.status === 'changed' ? 1 : 2) -
          (b.status === 'needs_review' ? 0 : b.status === 'changed' ? 1 : 2)
      ) ?? [];
  return (
    <FlatList
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.pad}
      data={(review ? rows : students) as Array<RosterRow | Student>}
      keyExtractor={(r) => ('rowIndex' in r ? String(r.rowIndex) : r.id)}
      initialNumToRender={10}
      maxToRenderPerBatch={10}
      windowSize={3}
      ListHeaderComponent={
        <>
          <Title>{t('importRoster')}</Title>
          <Body>{rosterNotices[route === 'off' ? 'rules' : route][language]}</Body>
          <Feedback {...action} t={t} />
          {!review && (
            <>
              <Button label={t('pickFile')} onPress={() => void action.run(pick)} />
              <Field
                label={t('pasteNames')}
                multiline
                value={text}
                onChange={(value) => {
                  setText(value);
                  setBinary(null);
                  setFilename('names.txt');
                  setEncodingReview(false);
                  setCloudAck(false);
                }}
              />
              <Body>{filename}</Body>
              <Field label={t('sheetName')} value={sheet} onChange={setSheet} />
              <Button
                primary
                disabled={!canWrite || action.busy || (!text && !binary)}
                label={t('cleanWithoutAI')}
                onPress={() => void action.run(() => parse(false))}
              />
              <Button
                disabled={!canWrite || action.busy || (!text && !binary) || (!!binary && !online)}
                label={t('exactlyWritten')}
                onPress={() => void action.run(() => parse(true))}
              />
              {online && route !== 'off' && route !== 'rules' && (
                <>
                  {route === 'cloud' && (
                    <>
                      <Body>{rosterNotices.cloud[language]}</Body>
                      <Body>{t('cloudConsent')}</Body>
                      <Switch
                        accessibilityLabel={t('cloudConsent')}
                        value={cloudAck}
                        onValueChange={setCloudAck}
                      />
                    </>
                  )}
                  <Button
                    label={t('cleanWithAI')}
                    disabled={
                      !canWrite ||
                      action.busy ||
                      (!text && !binary) ||
                      (route === 'cloud' && !cloudAck)
                    }
                    onPress={() => void action.run(ai)}
                  />
                </>
              )}
              <Body>{t('pasteFallback')}</Body>
            </>
          )}
          {review && (
            <>
              <Body>
                {review.draft.counts.linesRead} {t('linesRead')} · {review.draft.counts.students}{' '}
                {t('students')} · {review.draft.counts.needsReview} {t('needsReview')} ·{' '}
                {review.draft.counts.notStudents} {t('notStudents')}
              </Body>
              <Body>
                {review.draft.aiUsed
                  ? review.draft.route === 'cloud'
                    ? rosterNotices.cloudHistory[language]
                    : t('cleanedAI')
                  : t('cleanWithoutAI')}
              </Body>
              <Body>
                {t('droppedColumns')}: {review.draft.droppedColumns.join(', ')}
              </Body>
              <Title>{t('columnMapping')}</Title>
              {review.draft.columns.map((column) => (
                <Button
                  key={column.index}
                  disabled={
                    !canWrite ||
                    !!review.key ||
                    !!review.savedRows.length ||
                    column.field === 'drop'
                  }
                  label={`${column.header}: ${t(`rosterField_${column.field}` as never)}`}
                  onPress={() =>
                    void action.run(async () => {
                      const allowed = RosterField.options.filter((f) => f !== 'drop');
                      const next =
                        allowed[(allowed.indexOf(column.field as never) + 1) % allowed.length]!;
                      setReview(
                        await rt.features.roster.remap(
                          classId,
                          review.draft.columns.map((c) =>
                            c.index === column.index ? { ...c, field: next } : c
                          )
                        )
                      );
                    })
                  }
                />
              ))}
              <Title>{t('defaultGradeGroup')}</Title>
              {groups.map((g) => (
                <Button
                  key={g.id}
                  label={`${defaultGroup === g.id ? '✓ ' : ''}${t('group')} ${g.grade}`}
                  onPress={() => setDefaultGroup(g.id)}
                />
              ))}
              <Button label={t('viewChanged')} onPress={() => setViewedChanged(true)} />
              <Button
                primary
                disabled={!canWrite || action.busy}
                label={t('saveResolved')}
                onPress={() =>
                  void action.run(async () => {
                    setReview(
                      await rt.features.roster.confirm(classId, defaultGroup, viewedChanged)
                    );
                    await refresh();
                  })
                }
              />
              <Button
                label={t('abandonImport')}
                onPress={() =>
                  void action.run(async () => {
                    await rt.features.roster.abandon(classId, online);
                    await refresh();
                  })
                }
              />
            </>
          )}
          {!review && (
            <>
              <Title>{t('students')}</Title>
              <Button
                label={t('addStudent')}
                disabled={!canWrite}
                onPress={() =>
                  setManual({
                    id: `student-${Date.now()}`,
                    classId,
                    gradeGroupId: defaultGroup,
                    displayName: '',
                    familyName: '',
                    givenName: '',
                    middleName: '',
                    suffix: '',
                    sex: null,
                    localId: null,
                    order: students.length,
                    importId: null,
                  })
                }
              />
              {manual && (
                <>
                  <Field
                    label={t('name')}
                    value={manual.displayName}
                    onChange={(displayName) => setManual({ ...manual, displayName })}
                  />
                  {(['familyName', 'givenName', 'middleName', 'suffix', 'localId'] as const).map(
                    (field) => (
                      <Field
                        key={field}
                        label={t(`rosterField_${field}` as never)}
                        value={manual[field] ?? ''}
                        onChange={(v) => setManual({ ...manual, [field]: v })}
                      />
                    )
                  )}
                  <Button
                    label={`${t('rosterField_sex')}: ${manual.sex ?? t('notProvided')}`}
                    onPress={() =>
                      setManual({
                        ...manual,
                        sex: manual.sex === null ? 'M' : manual.sex === 'M' ? 'F' : null,
                      })
                    }
                  />
                  {groups.map((g) => (
                    <Button
                      key={g.id}
                      label={`${manual.gradeGroupId === g.id ? '✓ ' : ''}${t('group')} ${g.grade}`}
                      onPress={() => setManual({ ...manual, gradeGroupId: g.id })}
                    />
                  ))}
                  <Button
                    primary
                    label={t('save')}
                    disabled={
                      !canWrite ||
                      !manual.displayName.trim() ||
                      !safeNameCell(manual.displayName) ||
                      !!manual.localId?.match(/\d{8,}/)
                    }
                    onPress={() =>
                      void action.run(async () => {
                        await rt.engine.put('student', manual);
                        setManual(null);
                        await refresh();
                      })
                    }
                  />
                </>
              )}
            </>
          )}
        </>
      }
      renderItem={({ item }) => {
        if (!('rowIndex' in item))
          return (
            <View style={styles.card}>
              <Body>{item.displayName}</Body>
              <Button label={t('edit')} disabled={!canWrite} onPress={() => setManual(item)} />
            </View>
          );
        const row = item;
        return (
          <View style={styles.card}>
            <Body>
              {row.rowIndex + 1} · {t(`roster_${row.status}` as never)}
            </Body>
            <Body>
              {t('originalText')}: {row.original}
            </Body>
            <Body>
              {t('proposedText')}: {row.proposed.displayName}
            </Body>
            <Body>
              {[
                row.proposed.familyName,
                row.proposed.givenName,
                row.proposed.middleName,
                row.proposed.suffix,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Body>
            {row.flags.map((flag) => (
              <Body key={flag}>{t(`flag_${flag}` as never)}</Body>
            ))}
            {row.removed.length > 0 && <Body>{t('annotationsRemoved')}</Body>}
            {review?.resolutions.find((r) => r.rowIndex === row.rowIndex) && (
              <Body>{t('resolved')}</Body>
            )}
            {(['accept', 'keep_original', 'not_student'] as const).map((kind) => (
              <Button
                key={kind}
                disabled={!canWrite || !!review?.key}
                label={t(`row_${kind}` as never)}
                onPress={() => void action.run(() => resolve(row, kind))}
              />
            ))}
            <Button
              label={t('row_edit')}
              disabled={!canWrite || !!review?.key}
              onPress={() => {
                setEditRow(row.rowIndex);
                setRowMode('edit');
                setEdited(row.proposed.displayName);
                setEditedProposal(row.proposed);
                setSplit(row.original);
              }}
            />
            <Button
              label={t('row_split')}
              disabled={!canWrite || !!review?.key}
              onPress={() => {
                setEditRow(row.rowIndex);
                setRowMode('split');
                setSplit(row.original);
                setEditedProposal(row.proposed);
              }}
            />
            {editRow === row.rowIndex && (
              <>
                {rowMode === 'edit' && (
                  <>
                    <Field label={t('name')} value={edited} onChange={setEdited} />
                    {editedProposal &&
                      (['familyName', 'givenName', 'middleName', 'suffix', 'localId'] as const).map(
                        (field) => (
                          <Field
                            key={field}
                            label={t(`rosterField_${field}` as never)}
                            value={editedProposal[field] ?? ''}
                            onChange={(value) =>
                              setEditedProposal({ ...editedProposal, [field]: value })
                            }
                          />
                        )
                      )}
                    {editedProposal && (
                      <Button
                        label={`${t('rosterField_sex')}: ${editedProposal.sex ?? t('notProvided')}`}
                        onPress={() =>
                          setEditedProposal({
                            ...editedProposal,
                            sex:
                              editedProposal.sex === null
                                ? 'M'
                                : editedProposal.sex === 'M'
                                  ? 'F'
                                  : null,
                          })
                        }
                      />
                    )}
                    {editedProposal &&
                      groups.map((g) => (
                        <Button
                          key={g.id}
                          label={`${editedProposal.grade === g.grade ? '✓ ' : ''}${t('group')} ${g.grade}`}
                          onPress={() =>
                            setEditedProposal({ ...editedProposal, grade: g.grade as never })
                          }
                        />
                      ))}
                    <Button
                      label={t('row_edit')}
                      onPress={() => void action.run(() => resolve(row, 'edit'))}
                    />
                  </>
                )}
                {rowMode === 'split' && (
                  <>
                    {' '}
                    <Field label={t('splitNames')} multiline value={split} onChange={setSplit} />
                    <Button
                      label={t('row_split')}
                      onPress={() => void action.run(() => resolve(row, 'split'))}
                    />
                  </>
                )}
              </>
            )}
          </View>
        );
      }}
    />
  );
}
