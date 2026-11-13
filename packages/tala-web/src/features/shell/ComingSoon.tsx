'use client';
import { useT, type StringKey } from '@/i18n';
import { EmptyState, LinkButton, PageHeader } from '@/components/ui';

/** Wave-2 placeholder: route + nav entry + plain "coming soon" state with one useful action (SIMPLE-10). */
export function ComingSoon({
  titleKey,
  bodyKey,
  action,
}: {
  titleKey: StringKey;
  bodyKey: StringKey;
  action?: { href: string; labelKey: StringKey };
}) {
  const { t } = useT();
  return (
    <>
      <PageHeader title={t(titleKey)} />
      <EmptyState
        action={
          action ? <LinkButton href={action.href}>{t(action.labelKey)}</LinkButton> : undefined
        }
      >
        <strong>{t('common.comingSoon')}.</strong> {t(bodyKey)}
      </EmptyState>
    </>
  );
}
