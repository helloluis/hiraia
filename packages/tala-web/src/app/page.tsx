import { redirect } from 'next/navigation';

/** The app opens on This Week (PACE-1). */
export default function Home() {
  redirect('/week');
}
