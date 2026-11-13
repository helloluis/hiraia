'use client';
/** Settings holds exactly five items (SIMPLE-4): language, account, school and school year, data saver, sign out. */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatTime, useT } from '@/i18n';
import { useSession } from '@/data/session';
import { useWorkspace } from '@/data/records';
import { getClient } from '@/data/client';
import { ensureProfile } from '@/data/profile';
import { errorKey } from '@/data/errors';
import {
  Banner,
  Button,
  List,
  ListRow,
  PageHeader,
  Select,
  Sheet,
  Switch,
  TextInput,
  Toast,
} from '@/components/ui';
import { LanguageSwitch } from '@/features/auth/LanguageSwitch';
import { GoogleAccountSheets, type AccountSheet } from './GoogleAccountSheets';

export function SettingsScreen() {
  const { t, lang } = useT();
  const router = useRouter();
  const { user, engine, signOut, network, setDataSaver, config } = useSession();
  const [accountSheet, setAccountSheet] = useState<AccountSheet>('none');
  const googleOn = config?.features.googleSignIn === true;
  const ws = useWorkspace();
  const [sheet, setSheet] = useState<'none' | 'password' | 'devices' | 'delete' | 'signout'>(
    'none'
  );
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Language is a per-account preference too (TeacherProfile.uiLanguage); keep it in step with the device choice.
  useEffect(() => {
    if (ws.profile && ws.profile.uiLanguage !== lang && engine)
      void engine.put('profile', { ...ws.profile, uiLanguage: lang });
  }, [lang, ws.profile, engine]);
  useEffect(() => {
    if (ws.profile) setDataSaver(ws.profile.dataSaver);
  }, [ws.profile, setDataSaver]);

  const toggleSaver = async (on: boolean) => {
    if (!engine) return;
    const p = await ensureProfile(engine, user, lang);
    await engine.put('profile', { ...p, dataSaver: on });
    setDataSaver(on);
  };

  return (
    <div className="flex flex-col gap-3 max-w-[40rem]">
      <PageHeader title={t('settings.title')} />

      {/* 1. Language */}
      <section className="rounded border border-hairline bg-white p-3 flex flex-wrap items-center justify-between gap-3">
        <span className="font-medium">{t('settings.language')}</span>
        <LanguageSwitch />
      </section>

      {/* 2. Account */}
      <section className="rounded border border-hairline bg-white">
        <h2 className="px-3 pt-3 text-title">{t('settings.account')}</h2>
        <List className="border-0 rounded-none">
          <ListRow
            title={user?.displayName ?? ''}
            subtitle={user?.email ?? ''}
            trailing={
              user && !user.emailVerified ? (
                <Link href="/verify-email" className="text-talaTealText underline">
                  {t('settings.verifyNow')}
                </Link>
              ) : undefined
            }
          />
          {user && !user.emailVerified && (
            <div className="px-3 pb-2">
              <Banner kind="warn">{t('settings.emailUnverified')}</Banner>
            </div>
          )}
          {user?.hasPassword && (
            <ListRow title={t('settings.changePassword')} onClick={() => setSheet('password')} />
          )}
          {googleOn && !user?.hasGoogle && (
            <ListRow
              title={t('google.notConnected')}
              subtitle={t('google.connect')}
              onClick={() => setAccountSheet('connect')}
            />
          )}
          {user?.hasGoogle && (
            <ListRow
              title={t('google.connected')}
              subtitle={t('google.disconnect')}
              onClick={() => setAccountSheet('disconnect')}
            />
          )}
          {googleOn && user?.hasGoogle && user.hasPassword && (
            <ListRow
              title={t('google.removePassword')}
              onClick={() => setAccountSheet('removePassword')}
            />
          )}
          <ListRow title={t('merge.title')} onClick={() => setAccountSheet('merge')} />
          <ListRow title={t('settings.sessions')} onClick={() => setSheet('devices')} />
          <ListRow
            title={t('settings.export')}
            onClick={async () => {
              setBusy(true);
              try {
                const data = await getClient().call('account.export');
                const blob = new Blob([JSON.stringify(data, null, 2)], {
                  type: 'application/json',
                });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'tala-export.json';
                a.click();
              } catch {
                setToast(t('error.generic'));
              } finally {
                setBusy(false);
              }
            }}
          />
          <ListRow
            title={<span className="text-brick">{t('settings.deleteAccount')}</span>}
            onClick={() => setSheet('delete')}
          />
        </List>
      </section>

      {/* 3. School and school year */}
      <section className="rounded border border-hairline bg-white p-3 flex flex-col gap-3">
        <h2 className="text-title">{t('settings.school')}</h2>
        <TextInput
          label={t('setup.schoolName')}
          defaultValue={ws.activeYear?.schoolName || ws.profile?.schoolName || ''}
          onBlur={async (e) => {
            if (!engine) return;
            const v = e.target.value.trim();
            const p = await ensureProfile(engine, user, lang);
            await engine.put('profile', { ...p, schoolName: v });
            if (ws.activeYear) await engine.put('school_year', { ...ws.activeYear, schoolName: v });
          }}
        />
        <TextInput
          label={t('settings.region')}
          optional
          defaultValue={ws.profile?.region ?? ''}
          onBlur={async (e) => {
            if (!engine) return;
            const p = await ensureProfile(engine, user, lang);
            await engine.put('profile', { ...p, region: e.target.value.trim() });
          }}
        />
        {ws.years.length > 0 ? (
          <Select
            label={t('settings.activeYear')}
            value={ws.activeYear?.id ?? ''}
            onChange={async (e) => {
              if (!engine) return;
              const p = await ensureProfile(engine, user, lang);
              await engine.put('profile', { ...p, activeSchoolYearId: e.target.value });
            }}
          >
            {ws.years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.label} · {y.startDate} → {y.endDate}
                {y.provisional ? ' *' : ''}
              </option>
            ))}
          </Select>
        ) : (
          <p className="text-forestMuted">{t('settings.noYear')}</p>
        )}
        {ws.activeYear?.provisional && (
          <p className="text-small text-forestMuted">* {t('setup.provisional')}</p>
        )}
      </section>

      {/* 4. Data saver */}
      <section className="rounded border border-hairline bg-white p-3">
        <Switch
          label={t('settings.dataSaver')}
          hint={`${t('settings.dataSaverHint')} ${t('settings.dataUsed', { kb: Math.round(network.bytesThisWeek / 1024) })}`}
          checked={network.dataSaver}
          onChange={(v) => void toggleSaver(v)}
        />
      </section>

      {/* 5. Sign out */}
      <Button variant="secondary" full onClick={() => setSheet('signout')}>
        {t('settings.signOut')}
      </Button>

      <PasswordSheet
        open={sheet === 'password'}
        onClose={() => setSheet('none')}
        onDone={() => setToast(t('settings.passwordChanged'))}
      />
      <GoogleAccountSheets
        sheet={accountSheet}
        onClose={() => setAccountSheet('none')}
        onDone={(m) => m && setToast(m)}
      />
      <DevicesSheet
        open={sheet === 'devices'}
        onClose={() => setSheet('none')}
        onSignedOutEverywhere={() => router.replace('/sign-in')}
      />
      <Sheet
        open={sheet === 'signout'}
        onClose={() => setSheet('none')}
        title={t('settings.signOut')}
        actions={
          <>
            <Button variant="quiet" onClick={() => setSheet('none')}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                await signOut();
                setBusy(false);
                router.replace('/sign-in');
              }}
            >
              {t('settings.signOut')}
            </Button>
          </>
        }
      >
        <p>{t('auth.signOutConfirm')}</p>
      </Sheet>
      <DeleteSheet
        open={sheet === 'delete'}
        onClose={() => setSheet('none')}
        onDeleted={async () => {
          await signOut();
          router.replace('/sign-in');
        }}
      />
      <Toast message={toast} onDone={() => setToast(null)} />
      <span className="sr-only" aria-live="polite">
        {busy ? t('common.waiting') : ''}
      </span>
    </div>
  );
}

function PasswordSheet({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('settings.changePassword')}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={next.length < 10 || !current}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await getClient().call('auth.changePassword', {
                  body: { currentPassword: current, newPassword: next },
                });
                onDone();
                onClose();
                setCurrent('');
                setNext('');
              } catch (e) {
                setError(t(errorKey(e)));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <TextInput
        label={t('settings.currentPassword')}
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <TextInput
        label={t('auth.newPassword')}
        hint={t('auth.passwordHint')}
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
      />
      {error && <Banner kind="error">{error}</Banner>}
    </Sheet>
  );
}

function DevicesSheet({
  open,
  onClose,
  onSignedOutEverywhere,
}: {
  open: boolean;
  onClose: () => void;
  onSignedOutEverywhere: () => void;
}) {
  const { t, lang } = useT();
  const { signOut } = useSession();
  const [sessions, setSessions] = useState<Array<{
    id: string;
    deviceLabel: string;
    lastSeenAt: string;
    current: boolean;
  }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setSessions(null);
    getClient()
      .call('auth.sessions')
      .then((r) => setSessions(r.sessions))
      .catch(() => setError(t('error.generic')));
  }, [open, t]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('settings.sessions')}
      actions={
        <Button
          variant="danger"
          onClick={async () => {
            try {
              await getClient().call('auth.logoutAll');
            } catch {
              /* offline: local sign-out still happens */
            }
            await signOut();
            onSignedOutEverywhere();
          }}
        >
          {t('settings.signOutEverywhere')}
        </Button>
      }
    >
      {error && <Banner kind="error">{error}</Banner>}
      {!sessions && !error && <div className="placeholder h-12" />}
      {sessions && (
        <List>
          {sessions.map((s) => (
            <ListRow
              key={s.id}
              title={s.deviceLabel || 'Web'}
              subtitle={formatTime(s.lastSeenAt, lang)}
              trailing={s.current ? t('settings.thisDevice') : undefined}
            />
          ))}
        </List>
      )}
    </Sheet>
  );
}

function DeleteSheet({
  open,
  onClose,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useT();
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('settings.deleteAccount')}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            busy={busy}
            disabled={confirm !== 'DELETE'}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await getClient().call('account.delete', {
                  body: { confirm: 'DELETE', password: password || undefined },
                });
                onDeleted();
              } catch (e) {
                setError(t(errorKey(e)));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('common.delete')}
          </Button>
        </>
      }
    >
      <p>{t('settings.deleteBody')}</p>
      <TextInput
        label={t('auth.password')}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <TextInput label="DELETE" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      {error && <Banner kind="error">{error}</Banner>}
    </Sheet>
  );
}
