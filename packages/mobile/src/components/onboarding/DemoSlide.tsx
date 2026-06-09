import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import type { Language } from '@hiraia/shared';

import {
  DEMO_ANSWER,
  DEMO_CAPTION,
  DEMO_IMAGE_SLUG,
  DEMO_QUESTION,
} from '../../config/onboarding';
import { resolveImage } from '../../generated/imageMap';
import { colors, fonts } from '../../theme';
import { ThinkingIndicator } from '../ThinkingIndicator';

const HIRAIA_AVATAR = require('../../../assets/hiraia-profile.png');
const DEMO_IMG = resolveImage(DEMO_IMAGE_SLUG);

type Phase = 'typing' | 'thinking' | 'answering' | 'done';

/**
 * Slide 2: a self-contained, looping mock of the chat — the user "types" a question
 * into the textfield, it sends, the thinking indicator shows, then Hiraia's reply
 * types in with an illustration. Holds 2s, then loops. Pure animation, no engine.
 */
export function DemoSlide({ language }: { language: Language }) {
  const question = DEMO_QUESTION[language];
  const answer = DEMO_ANSWER[language];

  const [draft, setDraft] = useState(''); // mock textfield content
  const [userMsg, setUserMsg] = useState(''); // sent user bubble ('' = hidden)
  const [reply, setReply] = useState(''); // assistant reply text
  const [phase, setPhase] = useState<Phase>('typing');

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number) => new Promise<void>((r) => timers.push(setTimeout(r, ms)));
    const typeInto = async (full: string, set: (s: string) => void, step: number) => {
      for (let i = 1; i <= full.length && !cancelled; i++) {
        set(full.slice(0, i));
        await wait(step);
      }
    };

    const run = async () => {
      while (!cancelled) {
        setDraft('');
        setUserMsg('');
        setReply('');
        setPhase('typing');
        await wait(600);
        await typeInto(question, setDraft, 60); // type into the textfield
        await wait(400);
        setUserMsg(question); // "send"
        setDraft('');
        setPhase('thinking');
        await wait(1700); // thinking indicator
        setPhase('answering');
        await typeInto(answer, setReply, 26); // reply streams in
        setPhase('done'); // image appears
        await wait(2000); // hold, then loop
      }
    };
    void run();
    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
    };
  }, [question, answer]);

  return (
    <View style={styles.slide}>
      <Text style={styles.caption}>{DEMO_CAPTION[language]}</Text>

      <View style={styles.frame}>
        <View style={styles.thread}>
          {!!userMsg && (
            <View style={[styles.row, styles.userRow]}>
              <View style={[styles.bubble, styles.userBubble]}>
                <Text style={[styles.bubbleText, styles.userText]}>{userMsg}</Text>
              </View>
            </View>
          )}

          {(phase === 'thinking' || phase === 'answering' || phase === 'done') && (
            <View style={[styles.row, styles.botRow]}>
              <Image source={HIRAIA_AVATAR} style={styles.avatar} />
              <View style={[styles.bubble, styles.botBubble]}>
                {phase === 'thinking' ? (
                  <ThinkingIndicator language={language} />
                ) : (
                  <>
                    <Text style={[styles.bubbleText, styles.botText]}>{reply}</Text>
                    {phase === 'done' && DEMO_IMG != null && (
                      <Image source={DEMO_IMG} style={styles.replyImage} resizeMode="cover" />
                    )}
                  </>
                )}
              </View>
            </View>
          )}
        </View>

        {/* mock textfield */}
        <View style={styles.inputBar}>
          <View style={styles.input}>
            <Text style={styles.inputText} numberOfLines={1}>
              {draft}
              {phase === 'typing' && <Text style={styles.caret}>▍</Text>}
            </Text>
          </View>
          <View style={styles.send}>
            <Text style={styles.sendIcon}>➤</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  caption: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 30,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: 22,
  },
  frame: {
    width: '100%',
    height: 420,
    backgroundColor: colors.paper,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.hairline,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  thread: { flex: 1, padding: 12, justifyContent: 'flex-end', gap: 10 },
  row: { flexDirection: 'row', maxWidth: '88%' },
  userRow: { alignSelf: 'flex-end' },
  botRow: { alignSelf: 'flex-start' },
  avatar: { width: 26, height: 26, borderRadius: 13, marginRight: 6, marginTop: 2 },
  bubble: { padding: 10, borderRadius: 16 },
  userBubble: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  botBubble: {
    backgroundColor: colors.bubble,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderBottomLeftRadius: 4,
    minWidth: 44,
  },
  bubbleText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  userText: { color: colors.white },
  botText: { color: colors.ink },
  replyImage: { width: 120, height: 120, borderRadius: 10, marginTop: 8 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: colors.white,
  },
  input: {
    flex: 1,
    height: 38,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 19,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  inputText: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  caret: { color: colors.primary },
  send: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendIcon: { color: colors.white, fontSize: 16 },
});
