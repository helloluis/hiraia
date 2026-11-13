import { ComingSoon } from '@/features/shell/ComingSoon';

/** WAVE 2: roster import UI (paste or upload, review screen). See WAVE2.md. */
export default function Page() {
  return <ComingSoon titleKey="wave2.roster" bodyKey="wave2.rosterBody" action={{ href: '/class', labelKey: 'nav.class' }} />;
}
