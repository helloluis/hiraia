/**
 * HOME (question-cards branch): the fact-feed "doomscroller" — one factoid per notebook
 * page, page flips up over the top spine, an MCQ interject every 4-5 pages.
 *
 * Chat is temporarily shelved on this branch (still available at the /chat route; the
 * engine still boots in the background from _layout so chat works if navigated to).
 */
import { CardFeedScreen } from '../../components/cards/CardFeedScreen';

export default function HomeScreen() {
  return <CardFeedScreen />;
}
