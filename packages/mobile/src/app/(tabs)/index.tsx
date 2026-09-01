/**
 * HOME — and now the app's only content screen: the fact-feed "doomscroller", one factoid
 * per notebook page, page flips up over the top spine, an MCQ interject every 4-5 pages.
 *
 * There is NO chat surface any more (route, store and components deleted). The on-device
 * model is a SINGLE-TURN CARD WRITER: the feed's search field hands it a typed topic plus
 * retrieved grounding and it prints ONE card (cardStore.ask → LocalEngine.answerQuery).
 * No dialogue, no follow-ups, no persona.
 */
import { CardFeedScreen } from '../../components/cards/CardFeedScreen';

export default function HomeScreen() {
  return <CardFeedScreen />;
}
