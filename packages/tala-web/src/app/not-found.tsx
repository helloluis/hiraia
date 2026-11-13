'use client';
import { useT } from '@/i18n';
import { LinkButton } from '@/components/ui';

export default function NotFound() {
  const { t } = useT();
  return (
    <main className="mx-auto max-w-[36rem] p-6 flex flex-col gap-4">
      <h1 className="text-display">{t('error.notFound')}</h1>
      <LinkButton href="/week" variant="primary">
        {t('error.goHome')}
      </LinkButton>
    </main>
  );
}
