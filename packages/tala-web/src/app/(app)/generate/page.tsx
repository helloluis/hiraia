import { ComingSoon } from '@/features/shell/ComingSoon';

/** WAVE 2: lesson generation UI. Query: classId, assignmentId, date, planId. See WAVE2.md. */
export default function Page() {
  return <ComingSoon titleKey="wave2.generate" bodyKey="wave2.generateBody" action={{ href: '/lessons/new', labelKey: 'wave2.openTemplate' }} />;
}
