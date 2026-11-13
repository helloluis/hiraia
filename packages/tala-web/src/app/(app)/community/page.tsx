import { ComingSoon } from '@/features/shell/ComingSoon';

/** WAVE 2: Community (search, copy, post). See WAVE2.md. */
export default function Page() {
  return <ComingSoon titleKey="wave2.community" bodyKey="wave2.communityBody" action={{ href: '/lessons', labelKey: 'nav.lessons' }} />;
}
