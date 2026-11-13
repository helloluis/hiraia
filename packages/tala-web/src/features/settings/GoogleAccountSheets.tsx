'use client';
/**
 * Settings → Account: connect / disconnect Google, remove the password, join another account (PRD §13.3 cases 3–5).
 * Each step asks for the proof the server needs and says in plain words what changes.
 */
import { useState } from 'react';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { getClient } from '@/data/client';
import { errorKey } from '@/data/errors';
import { Banner, Button, Choice, Sheet, TextInput, Waiting } from '@/components/ui';
import { GoogleButton } from '@/features/auth/GoogleButton';

export type AccountSheet = 'none' | 'connect' | 'disconnect' | 'removePassword' | 'merge';

export function GoogleAccountSheets({ sheet, onClose, onDone }: { sheet: AccountSheet; onClose: () => void; onDone: (message: string) => void }) {
  const { t } = useT();
  const { user, refreshUser, syncNow } = useSession();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mergeBy, setMergeBy] = useState<'password' | 'google'>('password');
  const [otherEmail, setOtherEmail] = useState('');
  const [otherPassword, setOtherPassword] = useState('');
  const [otherToken, setOtherToken] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');

  const close = () => {
    setPassword('');
    setOtherEmail('');
    setOtherPassword('');
    setOtherToken(null);
    setConfirm('');
    setError(null);
    onClose();
  };
  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refreshUser();
      onDone(done);
      close();
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Case 3: connect Google after re-entering the password */}
      <Sheet open={sheet === 'connect'} onClose={close} title={t('google.connect')}>
        <p>{t('google.connectBody')}</p>
        {user?.hasPassword && <TextInput label={t('auth.password')} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />}
        {(password || !user?.hasPassword) && (
          <GoogleButton
            onCredential={idToken =>
              void run(async () => {
                await getClient().call('auth.googleConnect', { body: { idToken, password } });
              }, t('google.connectDone'))
            }
          />
        )}
        {busy && <Waiting label={t('common.waiting')} />}
        {error && <Banner kind="error">{error}</Banner>}
      </Sheet>

      {/* Case 5: disconnect Google */}
      <Sheet
        open={sheet === 'disconnect'}
        onClose={close}
        title={t('google.disconnect')}
        actions={
          <>
            <Button variant="quiet" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              busy={busy}
              disabled={!password}
              onClick={() =>
                void run(async () => {
                  await getClient().call('auth.googleDisconnect', { body: { password } });
                }, t('google.disconnectDone'))
              }
            >
              {t('google.disconnect')}
            </Button>
          </>
        }
      >
        {user && !user.hasPassword ? <Banner kind="warn">{t('google.passwordRequired')}</Banner> : <p>{t('google.disconnectBody')}</p>}
        <TextInput label={t('auth.password')} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={!!user && !user.hasPassword} />
        {error && <Banner kind="error">{error}</Banner>}
      </Sheet>

      {/* Case 5: remove the password (Google stays) */}
      <Sheet
        open={sheet === 'removePassword'}
        onClose={close}
        title={t('google.removePassword')}
        actions={
          <>
            <Button variant="quiet" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              busy={busy}
              disabled={!password}
              onClick={() =>
                void run(async () => {
                  await getClient().call('auth.removePassword', { body: { currentPassword: password } });
                }, t('google.removePasswordDone'))
              }
            >
              {t('google.removePassword')}
            </Button>
          </>
        }
      >
        {user && !user.hasGoogle ? <Banner kind="warn">{t('google.lastMethod')}</Banner> : <p>{t('google.removePasswordBody')}</p>}
        <TextInput label={t('settings.currentPassword')} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
        {error && <Banner kind="error">{error}</Banner>}
      </Sheet>

      {/* Case 4: join another account into this one */}
      <Sheet
        open={sheet === 'merge'}
        onClose={close}
        title={t('merge.title')}
        actions={
          <>
            <Button variant="quiet" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              busy={busy}
              disabled={confirm !== 'MERGE' || (user?.hasPassword && !password) || (mergeBy === 'password' ? !otherEmail || !otherPassword : !otherToken)}
              onClick={() =>
                void run(async () => {
                  const r = await getClient().call('account.merge', {
                    body: { confirm: 'MERGE', currentPassword: user?.hasPassword ? password : undefined, email: mergeBy === 'password' ? otherEmail.trim() : undefined, password: mergeBy === 'password' ? otherPassword : undefined, idToken: mergeBy === 'google' ? (otherToken ?? undefined) : undefined },
                  });
                  await syncNow();
                  onDone(t('merge.done', { n: r.movedRecords }));
                }, '')
              }
            >
              {t('merge.action')}
            </Button>
          </>
        }
      >
        <p>{t('merge.body')}</p>
        {user?.hasPassword && <TextInput label={t('merge.current')} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />}
        <Choice
          label={t('merge.otherBy')}
          value={mergeBy}
          onChange={setMergeBy}
          options={[
            { value: 'password', label: t('merge.byPassword') },
            { value: 'google', label: t('merge.byGoogle') },
          ]}
        />
        {mergeBy === 'password' ? (
          <>
            <TextInput label={t('merge.otherEmail')} type="email" autoComplete="off" value={otherEmail} onChange={e => setOtherEmail(e.target.value)} />
            <TextInput label={t('merge.otherPassword')} type="password" autoComplete="off" value={otherPassword} onChange={e => setOtherPassword(e.target.value)} />
          </>
        ) : otherToken ? (
          <Banner kind="success">✓ Google</Banner>
        ) : (
          <GoogleButton onCredential={setOtherToken} />
        )}
        <TextInput label={t('merge.confirmWord')} value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="off" />
        {error && <Banner kind="error">{error}</Banner>}
      </Sheet>
    </>
  );
}
