import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import type { DeckDetail, DeckSlide } from '@hiraia/tala-core';
import { deckSlidesFromPack } from '@hiraia/tala-core/decks';
import { createTestServer } from '../../testing';
import type { TestServer, TestUser } from '../../testing';
import { createPacksModule } from '../packs';
import { createDecksModule } from './index';
import { readDeckDrawings, relationships, slideParts, xmlUnescape } from './pptx-read';
import { GLYPH_PNG_BASE64, WORDMARK_PNG_BASE64 } from './pptx-template';
import { PPTX_CONTENT_TYPE } from './pptx-write';
import { libraryFixture, SAMPLE_PACKS, sha, xmlProblem } from './testing';
import type { LibraryFixture, VariantSpec } from './testing';
import { readZip } from './zip';

const PACK = SAMPLE_PACKS[0] ?? '';
const OTHER = SAMPLE_PACKS[1] ?? '';
const skip = SAMPLE_PACKS.length < 2;

interface World {
  fx: LibraryFixture;
  t: TestServer;
  close(): void;
}
function world(
  specs: VariantSpec[] = [
    { packId: PACK, lang: 'en' },
    { packId: PACK, lang: 'fil' },
  ],
  production = false
): World {
  const fx = libraryFixture(specs);
  const t = createTestServer({
    modules: [createPacksModule(fx.options), createDecksModule(fx.options)],
    ...(production
      ? {
          config: { environment: 'production' as const, publicOrigin: 'https://tala.test' },
          core: { autoVerifyEmail: true },
        }
      : {}),
  });
  return {
    fx,
    t,
    close() {
      t.close();
      fx.cleanup();
    },
  };
}

const copy = (w: World, user: TestUser, packId = PACK, lang: 'en' | 'fil' = 'en') =>
  w.t.ok('decks.create', { body: { packId, lang }, token: user.token });
const get = (w: World, user: TestUser, deckId: string) =>
  w.t.ok('decks.get', { params: { deckId }, token: user.token });
const save = (
  w: World,
  user: TestUser,
  deckId: string,
  baseRev: number,
  slides: DeckSlide[],
  extra: { title?: string; force?: boolean } = {}
) =>
  w.t.call('decks.save', {
    params: { deckId },
    body: { baseRev, slides, ...extra },
    token: user.token,
  });
async function bytesOf(w: World, user: TestUser | null, path: string) {
  const res = await w.t.request('GET', path, user ? { token: user.token } : {});
  return {
    res,
    bytes: res.status === 200 ? new Uint8Array(await res.arrayBuffer()) : new Uint8Array(0),
  };
}

/** A teacher's evening with her copy: change an example, add a slide of her own, duplicate one, delete one, move one. */
function teacherEdits(original: DeckSlide[]) {
  const slides = structuredClone(original);
  const k = slides.findIndex((s) => s.kind === 'concept' && s.lines.length >= 2);
  slides[k]!.lines[0] = 'Example from our barangay: the carabao pulls the cart with a rope.';
  slides[k]!.notes = `${slides[k]!.notes}\nMy note: ask the class for their own example first.`;
  const added: DeckSlide = {
    id: 'nmine0001',
    day: slides[k]!.day,
    kind: 'activity',
    title: 'Try it in our classroom',
    lines: ['Find three examples in the room.', 'Write them in your notebook.'],
    choices: [],
    revealOf: null,
    correctChoice: null,
    image: null,
    notes: 'Five minutes. Walk around and look at each group.',
    sourceId: null,
  };
  slides.splice(k + 1, 0, added);
  const duplicate: DeckSlide = { ...structuredClone(slides[k]!), id: 'ndup00001', sourceId: null };
  slides.splice(k + 2, 0, duplicate);
  const [removed] = slides.splice(
    slides.findIndex((s, i) => i > k + 2 && s.kind === 'summary'),
    1
  );
  const q = slides.findIndex((s, i) => i > k + 2 && s.kind === 'question');
  const [moved] = slides.splice(q, 1);
  slides.splice(q + 2, 0, moved!);
  return {
    slides,
    editedId: slides[k]!.id,
    added,
    duplicate,
    removedId: removed!.id,
    movedId: moved!.id,
  };
}

test('every decks route needs a session', { skip }, async () => {
  const w = world();
  try {
    const id = 'deck-0001';
    const responses = [
      await w.t.request('GET', '/decks'),
      await w.t.request('POST', '/decks', { body: { packId: PACK, lang: 'en' } }),
      await w.t.request('GET', `/decks/${id}`),
      await w.t.request('PUT', `/decks/${id}`, { body: { baseRev: 1, slides: [] } }),
      await w.t.request('POST', `/decks/${id}/reset`),
      await w.t.request('DELETE', `/decks/${id}`),
      await w.t.request('GET', `/decks/${id}/media/some-drawing`),
      await w.t.request('GET', `/decks/${id}/pptx`),
      await w.t.request('GET', '/decks', { token: 'x'.repeat(43) }),
    ];
    for (const res of responses) {
      assert.equal(res.status, 401);
      assert.equal(
        ((await res.json()) as { error: { code: string } }).error.code,
        'unauthenticated'
      );
    }
    assert.equal(
      (w.t.db.prepare('SELECT COUNT(*) AS n FROM decks_decks').get() as { n: number }).n,
      0
    );
    assert.deepEqual(w.t.errors, []);
  } finally {
    w.close();
  }
});

test(
  'two teachers: a copy is private, edits stay in it, and the shared original is untouched',
  { skip },
  async () => {
    const w = world();
    try {
      const ana = await w.t.registerUser();
      const ben = await w.t.registerUser();
      const original = w.fx.variant(PACK, 'en');
      const filesBefore = w.fx.hashes();
      const detailBefore = await w.t.ok('packs.detail', {
        params: { packId: PACK },
        query: { lang: 'en' },
        token: ana.token,
      });

      // Ana makes her copy: the original's slides, the drawings its built deck embeds, nothing changed yet.
      const made = await copy(w, ana);
      assert.equal(made.deck.rev, 1);
      assert.equal(made.deck.packId, PACK);
      assert.equal(made.deck.language, 'en');
      assert.equal(made.deck.title, original.content.title);
      assert.deepEqual(
        [made.deck.grade, made.deck.term, made.deck.week],
        [original.content.grade, original.content.term, original.content.week]
      );
      assert.equal(made.deck.sourceApproved, false);
      assert.equal(made.deck.baseContentSha256, original.contentSha256);
      assert.deepEqual(made.original, { available: true, updated: false });
      assert.deepEqual(made.baseSlides, made.deck.slides, 'a fresh copy equals what was copied');
      const fromPack = deckSlidesFromPack(original.content);
      assert.deepEqual(
        made.deck.slides.map((s) => [
          s.id,
          s.kind,
          s.title,
          s.lines,
          s.choices,
          s.notes,
          s.sourceId,
        ]),
        fromPack.map((s) => [s.id, s.kind, s.title, s.lines, s.choices, s.notes, s.id])
      );
      assert.deepEqual(
        made.deck.media.map((m) => m.slug).sort(),
        [...original.drawings.keys()].sort(),
        'every drawing the built deck embeds, and only those'
      );
      for (const m of made.deck.media) {
        assert.equal(m.sha256, original.drawings.get(m.slug)!.sha256);
        assert.deepEqual([m.width, m.height], [64, 68]);
        assert.ok(m.alt.length > 0);
      }
      for (const s of made.deck.slides)
        assert.ok(
          !s.image || original.drawings.has(s.image.slug),
          'a slide only points at a drawing the copy holds'
        );
      assert.equal(
        (await copy(w, ana)).deck.id,
        made.deck.id,
        'asking again answers the same copy'
      );

      // Her drawings are served only to her, exactly as stored (the watermarked bytes), inline.
      for (const m of made.deck.media) {
        const { res, bytes } = await bytesOf(w, ana, `/decks/${made.deck.id}/media/${m.slug}`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'image/png');
        assert.equal(res.headers.get('content-disposition'), null);
        assert.equal(sha(bytes), m.sha256);
      }
      assert.equal(
        (await bytesOf(w, ana, `/decks/${made.deck.id}/media/not-in-this-deck`)).res.status,
        404
      );

      // She edits and saves; a reload shows exactly her slides.
      w.t.clock.advance({ minutes: 5 });
      const edits = teacherEdits(made.deck.slides);
      const saved = await save(w, ana, made.deck.id, 1, edits.slides);
      assert.equal(saved.ok, true);
      assert.deepEqual(saved.data, {
        rev: 2,
        updatedAt: w.t.clock.now().toISOString(),
        changedSlides: 3,
      });
      const reloaded = await get(w, ana, made.deck.id);
      assert.deepEqual(reloaded.deck.slides, edits.slides);
      assert.deepEqual(
        reloaded.baseSlides,
        made.baseSlides,
        'what was copied is kept beside the edits'
      );
      assert.equal(reloaded.deck.rev, 2);
      assert.ok(!reloaded.deck.slides.some((s) => s.id === edits.removedId));
      const mine = await w.t.ok('decks.list', { token: ana.token });
      assert.deepEqual(mine.decks, [
        {
          id: made.deck.id,
          packId: PACK,
          language: 'en',
          title: original.content.title,
          grade: original.content.grade,
          term: original.content.term,
          week: original.content.week,
          slideCount: edits.slides.length,
          changedSlides: 3,
          rev: 2,
          updatedAt: w.t.clock.now().toISOString(),
        },
      ]);

      // Ben sees none of it, and cannot reach it by its id: every route answers as if the deck did not exist.
      assert.deepEqual((await w.t.ok('decks.list', { token: ben.token })).decks, []);
      const missing = await w.t.call('decks.get', {
        params: { deckId: 'no-such-deck' },
        token: ben.token,
      });
      const theirs = await w.t.call('decks.get', {
        params: { deckId: made.deck.id },
        token: ben.token,
      });
      assert.equal(theirs.status, 404);
      assert.deepEqual(
        theirs.error,
        missing.error,
        'someone else’s deck is indistinguishable from a missing one'
      );
      assert.equal((await save(w, ben, made.deck.id, 2, edits.slides)).status, 404);
      assert.equal(
        (await save(w, ben, made.deck.id, 2, edits.slides, { force: true })).status,
        404
      );
      assert.equal(
        (await w.t.call('decks.reset', { params: { deckId: made.deck.id }, token: ben.token }))
          .status,
        404
      );
      assert.equal(
        (await w.t.call('decks.delete', { params: { deckId: made.deck.id }, token: ben.token }))
          .status,
        404
      );
      assert.equal(
        (await bytesOf(w, ben, `/decks/${made.deck.id}/media/${made.deck.media[0]!.slug}`)).res
          .status,
        404
      );
      assert.equal((await bytesOf(w, ben, `/decks/${made.deck.id}/pptx`)).res.status, 404);

      // Ben's own copy of the same pack starts from the original, not from Ana's edits.
      const bens = await copy(w, ben);
      assert.notEqual(bens.deck.id, made.deck.id);
      assert.equal(bens.deck.rev, 1);
      assert.deepEqual(bens.deck.slides, made.baseSlides);
      assert.ok(!JSON.stringify(bens).includes('carabao'));

      // Ana's copy is exactly as she left it; the shared original and every library file are byte-identical.
      assert.deepEqual((await get(w, ana, made.deck.id)).deck, reloaded.deck);
      assert.deepEqual(
        await w.t.ok('packs.detail', {
          params: { packId: PACK },
          query: { lang: 'en' },
          token: ana.token,
        }),
        detailBefore
      );
      assert.deepEqual(w.fx.hashes(), filesBefore);
      const deck = await bytesOf(w, ben, `/packs/${PACK}/files/slides?lang=en`);
      assert.equal(sha(deck.bytes), sha(original.deck!));
      assert.deepEqual(
        w.t.db
          .prepare(
            'SELECT owner_id, COUNT(*) AS n FROM decks_decks GROUP BY owner_id ORDER BY owner_id'
          )
          .all(),
        [ana.id, ben.id].sort().map((owner_id) => ({ owner_id, n: 1 }))
      );
      // Two copies of one pack share its drawings: each is stored once.
      assert.equal(
        (w.t.db.prepare('SELECT COUNT(*) AS n FROM decks_media').get() as { n: number }).n,
        original.drawings.size
      );
      // Nothing a teacher typed reaches the log.
      const logged = JSON.stringify(w.t.logs);
      assert.ok(
        !logged.includes('carabao') &&
          !logged.includes('Walk around') &&
          !logged.includes(ana.email)
      );
      assert.deepEqual(w.t.errors, []);
    } finally {
      w.close();
    }
  }
);

test(
  'the original’s drawings are served like the pack itself (packs.media)',
  { skip },
  async () => {
    const w = world([
      { packId: PACK, lang: 'en' },
      { packId: OTHER, lang: 'en', withoutDeck: true },
    ]);
    try {
      const ana = await w.t.registerUser();
      const original = w.fx.variant(PACK, 'en');
      for (const [slug, d] of original.drawings) {
        const { res, bytes } = await bytesOf(w, ana, `/packs/${PACK}/media/${slug}?lang=en`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'image/png');
        assert.equal(res.headers.get('content-disposition'), null, 'drawings display inline');
        assert.equal(sha(bytes), d.sha256, 'exactly the bytes the built deck embeds');
      }
      const slug = [...original.drawings.keys()][0]!;
      assert.equal(
        (await bytesOf(w, null, `/packs/${PACK}/media/${slug}?lang=en`)).res.status,
        404,
        'a draft’s drawings are not public'
      );
      assert.equal(
        (await bytesOf(w, ana, `/packs/${PACK}/media/no-such-drawing?lang=en`)).res.status,
        404
      );
      assert.equal(
        (
          await bytesOf(
            w,
            ana,
            `/packs/${PACK}/media/${encodeURIComponent('../../etc/passwd')}?lang=en`
          )
        ).res.status,
        404
      );
      assert.equal(
        (await bytesOf(w, ana, `/packs/${PACK}/media/${slug}?lang=fil`)).res.status,
        404,
        'a language that is not built has no drawings'
      );
      assert.equal(
        (await bytesOf(w, ana, `/packs/${OTHER}/media/${slug}?lang=en`)).res.status,
        404,
        'a version whose deck is not built has no drawings'
      );
      assert.equal(
        (await bytesOf(w, ana, `/packs/sci26-g4-t1-w99/media/${slug}?lang=en`)).res.status,
        404
      );
      // A deck whose bytes no longer match its build manifest is not read.
      const file = join(
        w.fx.options.artifactsDir,
        PACK,
        'en',
        `tala-${PACK.slice(6)}-en-slides.pptx`
      );
      writeFileSync(file, Buffer.from('PK tampered'));
      const tampered = await w.t.request('GET', `/packs/${PACK}/media/${slug}?lang=en`, {
        token: ana.token,
      });
      assert.equal(tampered.status, 404);
      assert.match(
        ((await tampered.json()) as { error: { message: string } }).error.message,
        /being rebuilt/
      );
      assert.deepEqual(w.t.errors, []);
    } finally {
      w.close();
    }
  }
);

test(
  'a save from an older version is refused with the stored rev; "keep my version" saves',
  { skip },
  async () => {
    const w = world();
    try {
      const ana = await w.t.registerUser();
      const made = await copy(w, ana);
      const phone = structuredClone(made.deck.slides);
      const laptop = structuredClone(made.deck.slides);
      phone[2]!.title = 'Changed on the phone';
      laptop[2]!.title = 'Changed on the laptop';
      w.t.clock.advance({ minutes: 1 });
      const first = await save(w, ana, made.deck.id, 1, phone);
      assert.equal(first.data?.rev, 2);
      w.t.clock.advance({ minutes: 1 });
      const stale = await save(w, ana, made.deck.id, 1, laptop);
      assert.equal(stale.status, 409);
      assert.equal(stale.error?.code, 'conflict');
      assert.deepEqual(stale.error?.details, {
        reason: 'deck_changed_elsewhere',
        rev: 2,
        updatedAt: first.data!.updatedAt,
      });
      assert.equal(
        (await get(w, ana, made.deck.id)).deck.slides[2]!.title,
        'Changed on the phone',
        'a refused save changes nothing'
      );
      const forced = await save(w, ana, made.deck.id, 1, laptop, { force: true });
      assert.equal(forced.data?.rev, 3);
      assert.equal(
        (await get(w, ana, made.deck.id)).deck.slides[2]!.title,
        'Changed on the laptop'
      );
      assert.equal(
        (await save(w, ana, made.deck.id, 3, laptop)).data?.rev,
        4,
        'the new rev is the one to save from next'
      );
      assert.equal((await save(w, ana, 'no-such-deck', 1, laptop)).status, 404);
      assert.deepEqual(w.t.errors, []);
    } finally {
      w.close();
    }
  }
);

test(
  'what a save may store: tidy text, known drawings, live links, unique ids, and always the credits slide',
  { skip },
  async () => {
    const w = world();
    try {
      const ana = await w.t.registerUser();
      const made = await copy(w, ana);
      const base = made.deck.slides;
      const send = (slides: DeckSlide[], extra: { title?: string } = {}) =>
        save(w, ana, made.deck.id, 1, slides, { force: true, ...extra });

      // Untouched slides sent straight back count as unchanged.
      assert.equal((await send(structuredClone(base))).data?.changedSlides, 0);

      const slides = structuredClone(base);
      const withImage = slides.findIndex((s) => s.image);
      const check = slides.findIndex((s) => s.kind === 'check' && s.choices.length > 0);
      const reveal = slides.findIndex(
        (s) => s.kind === 'reveal' && s.revealOf === slides[check]!.id
      );
      assert.ok(withImage > 0 && check > 0 && reveal > 0);
      slides[1]!.title = '  A title\nwith a line break\tand   spaces  ';
      slides[1]!.lines = ['  one  ', '', '   ', 'two\r\nlines'];
      slides[1]!.notes = '  First line.\r\nSecond line.  \n';
      slides[withImage]!.image = { slug: slides[withImage]!.image!.slug, alt: '' };
      slides[check]!.image = { slug: 'a-drawing-from-somewhere-else', alt: 'Not ours' };
      slides[reveal]!.revealOf = 'd5s99';
      slides[3]!.sourceId = 'd9s9';
      const saved = await send(slides, { title: '  My Grade 4 magnets deck  ' });
      assert.equal(saved.ok, true);
      const after = (await get(w, ana, made.deck.id)).deck;
      assert.equal(after.title, 'My Grade 4 magnets deck');
      assert.equal(after.slides[1]!.title, 'A title with a line break and spaces');
      assert.deepEqual(after.slides[1]!.lines, ['one', 'two lines']);
      assert.equal(
        after.slides[1]!.notes,
        'First line.\nSecond line.',
        'notes keep their line breaks'
      );
      assert.deepEqual(
        after.slides[withImage]!.image,
        base[withImage]!.image,
        'an empty alt text is filled from the drawing’s own'
      );
      assert.equal(
        after.slides[check]!.image,
        null,
        'a drawing that is not this copy’s is dropped'
      );
      assert.equal(
        after.slides[reveal]!.revealOf,
        null,
        'a link to a slide that is not there is cleared'
      );
      assert.equal(after.slides[3]!.sourceId, null);
      assert.equal((await send(structuredClone(after.slides))).ok, true);
      assert.equal(
        (await get(w, ana, made.deck.id)).deck.title,
        'My Grade 4 magnets deck',
        'a save without a title keeps the title'
      );

      const twice = structuredClone(base);
      twice[5]!.id = twice[4]!.id;
      const duplicate = await send(twice);
      assert.equal(duplicate.status, 400);
      assert.deepEqual(duplicate.error?.details, { reason: 'duplicate_slide_id' });

      const noCredits = await send(base.filter((s) => s.kind !== 'credits'));
      assert.equal(noCredits.status, 400);
      assert.equal(noCredits.error?.message, 'The credits slide stays with every copy.');
      assert.deepEqual(noCredits.error?.details, { reason: 'credits_slide_required' });

      // The cover carries the draft label, so it stays too.
      const noCover = await send(base.filter((s) => s.kind !== 'cover'));
      assert.equal(noCover.status, 400);
      assert.equal(noCover.error?.message, 'The cover slide stays with every copy.');
      assert.deepEqual(noCover.error?.details, { reason: 'cover_slide_required' });

      // The contract's own limits are enforced before anything is stored.
      const many = Array.from(
        { length: 121 },
        (_x, i): DeckSlide => ({
          ...structuredClone(base[1]!),
          id: `n${String(i).padStart(5, '0')}`,
          sourceId: null,
        })
      );
      assert.equal((await send(many)).status, 400);
      assert.equal((await send([])).status, 400);
      const long = structuredClone(base);
      long[1]!.title = 'x'.repeat(141);
      assert.equal((await send(long)).status, 400);
      const badId = structuredClone(base);
      badId[1]!.id = 'slide one';
      assert.equal((await send(badId)).status, 400);

      assert.deepEqual(
        (await get(w, ana, made.deck.id)).deck.slides,
        after.slides,
        'refused saves changed nothing'
      );
      assert.deepEqual(w.t.errors, []);
    } finally {
      w.close();
    }
  }
);

test(
  'a new library snapshot never touches a copy: changed pack, then withdrawn pack',
  { skip },
  async () => {
    const w = world([{ packId: PACK, lang: 'en' }]);
    try {
      const ana = await w.t.registerUser();
      const ben = await w.t.registerUser();
      const first = w.fx.variant(PACK, 'en');
      const made = await copy(w, ana);
      w.t.clock.advance({ minutes: 5 });
      const edits = teacherEdits(made.deck.slides);
      assert.equal((await save(w, ana, made.deck.id, 1, edits.slides)).data?.rev, 2);
      const mediaBefore = new Map<string, string>();
      for (const m of made.deck.media)
        mediaBefore.set(
          m.slug,
          sha((await bytesOf(w, ana, `/decks/${made.deck.id}/media/${m.slug}`)).bytes)
        );
      const exportBefore = (await bytesOf(w, ana, `/decks/${made.deck.id}/pptx`)).bytes;
      assert.ok(exportBefore.length > 1000);

      // (a) The host installs a snapshot in which the same pack was regenerated and its deck re-rendered.
      const [second] = w.fx.swap([
        {
          packId: PACK,
          lang: 'en',
          art: 2,
          edit: (c) => {
            c.title = `${c.title.slice(0, 60)} (2nd edition)`;
            c.slides[3]!.title = 'A new title from the library';
            c.slides.splice(
              c.slides.findIndex((s) => s.kind === 'summary'),
              1
            );
          },
        },
      ]);
      assert.notEqual(second!.contentSha256, first.contentSha256);
      assert.equal(
        (
          await w.t.ok('packs.detail', {
            params: { packId: PACK },
            query: { lang: 'en' },
            token: ana.token,
          })
        ).content.title,
        second!.content.title,
        'the library really changed'
      );

      const afterSwap = await get(w, ana, made.deck.id);
      assert.deepEqual(afterSwap.deck.slides, edits.slides, 'her edits are all there');
      assert.deepEqual(afterSwap.baseSlides, made.baseSlides);
      assert.equal(afterSwap.deck.baseContentSha256, first.contentSha256);
      assert.equal(afterSwap.deck.rev, 2);
      assert.deepEqual(
        afterSwap.original,
        { available: true, updated: true },
        'she is told the original has changed since'
      );
      let redrawn = 0;
      for (const m of made.deck.media) {
        assert.equal(
          sha((await bytesOf(w, ana, `/decks/${made.deck.id}/media/${m.slug}`)).bytes),
          mediaBefore.get(m.slug),
          'her copy keeps the drawings it was made with'
        );
        const now = await bytesOf(w, ana, `/packs/${PACK}/media/${m.slug}?lang=en`);
        if (now.res.status !== 200) continue; // the new edition no longer shows this drawing
        redrawn += 1;
        assert.equal(sha(now.bytes), second!.drawings.get(m.slug)!.sha256);
        assert.notEqual(
          sha(now.bytes),
          mediaBefore.get(m.slug),
          'while the library serves the new ones'
        );
      }
      assert.ok(redrawn >= 3, 'the snapshot really re-rendered drawings this copy uses');
      assert.deepEqual(
        Buffer.from((await bytesOf(w, ana, `/decks/${made.deck.id}/pptx`)).bytes),
        Buffer.from(exportBefore),
        'her download is byte-identical: it never reads the library'
      );
      assert.equal(
        (await copy(w, ana)).deck.id,
        made.deck.id,
        '"my copy" still answers the copy she has'
      );

      // A teacher who copies now gets the new original.
      const bens = await copy(w, ben);
      assert.equal(bens.deck.baseContentSha256, second!.contentSha256);
      assert.equal(bens.deck.slides[3]!.title, 'A new title from the library');
      assert.equal(bens.deck.slides.length, second!.content.slides.length);

      // Starting over is her choice: it replaces her edits with the library's current original.
      w.t.clock.advance({ minutes: 5 });
      const reset = await w.t.ok('decks.reset', {
        params: { deckId: made.deck.id },
        token: ana.token,
      });
      assert.equal(reset.deck.id, made.deck.id);
      assert.equal(reset.deck.rev, 3);
      assert.equal(reset.deck.title, second!.content.title);
      assert.equal(reset.deck.baseContentSha256, second!.contentSha256);
      assert.deepEqual(reset.original, { available: true, updated: false });
      assert.deepEqual(reset.deck.slides, bens.deck.slides);
      assert.deepEqual(reset.baseSlides, reset.deck.slides);
      assert.equal(reset.deck.createdAt, made.deck.createdAt);
      for (const m of reset.deck.media)
        assert.equal(m.sha256, second!.drawings.get(m.slug)!.sha256);
      const stored = (
        w.t.db.prepare('SELECT sha256 FROM decks_media').all() as Array<{ sha256: string }>
      )
        .map((r) => r.sha256)
        .sort();
      assert.deepEqual(
        stored,
        [...second!.drawings.values()].map((d) => d.sha256).sort(),
        'drawings no copy shows any more are gone; the rest are stored once'
      );

      // (b) Later the pack is withdrawn from the library altogether.
      w.t.clock.advance({ minutes: 5 });
      const again = teacherEdits(reset.deck.slides);
      assert.equal((await save(w, ana, made.deck.id, 3, again.slides)).data?.rev, 4);
      const exportBeforeRemoval = (await bytesOf(w, ana, `/decks/${made.deck.id}/pptx`)).bytes;
      w.fx.swap([{ packId: OTHER, lang: 'en' }]);
      assert.equal(
        (
          await w.t.call('packs.detail', {
            params: { packId: PACK },
            query: { lang: 'en' },
            token: ana.token,
          })
        ).status,
        404
      );

      const orphan = await get(w, ana, made.deck.id);
      assert.deepEqual(orphan.deck.slides, again.slides);
      assert.deepEqual(orphan.original, { available: false, updated: false });
      for (const m of orphan.deck.media)
        assert.equal(
          sha((await bytesOf(w, ana, `/decks/${made.deck.id}/media/${m.slug}`)).bytes),
          m.sha256
        );
      assert.deepEqual(
        Buffer.from((await bytesOf(w, ana, `/decks/${made.deck.id}/pptx`)).bytes),
        Buffer.from(exportBeforeRemoval)
      );
      assert.equal((await w.t.ok('decks.list', { token: ana.token })).decks.length, 1);
      assert.equal((await copy(w, ana)).deck.id, made.deck.id, 'her copy is still hers to open');
      const refused = await w.t.call('decks.reset', {
        params: { deckId: made.deck.id },
        token: ana.token,
      });
      assert.equal(refused.status, 404);
      assert.deepEqual(refused.error?.details, { reason: 'original_unavailable' });
      assert.match(refused.error!.message, /not in the library right now/);
      assert.deepEqual(
        (await get(w, ana, made.deck.id)).deck,
        orphan.deck,
        'a refused reset leaves the copy as it was'
      );
      const cara = await w.t.registerUser();
      assert.equal(
        (await w.t.call('decks.create', { body: { packId: PACK, lang: 'en' }, token: cara.token }))
          .status,
        404,
        'nobody can newly copy a withdrawn pack'
      );
      // She can still edit and save the orphaned copy.
      const more = structuredClone(again.slides);
      more[1]!.title = 'Still mine to change';
      assert.equal((await save(w, ana, made.deck.id, 4, more)).data?.rev, 5);

      // Even with no library on disk at all, her copy opens and downloads.
      renameSync(join(w.fx.root, 'library'), join(w.fx.root, 'library.gone'));
      assert.ok(!existsSync(join(w.fx.root, 'library')));
      assert.deepEqual((await get(w, ana, made.deck.id)).original, {
        available: false,
        updated: false,
      });
      assert.equal((await bytesOf(w, ana, `/decks/${made.deck.id}/pptx`)).res.status, 200);
      assert.deepEqual(w.t.errors, []);
    } finally {
      w.close();
    }
  }
);

test('a copy is made only from a consistent, built original', { skip }, async () => {
  const w = world([
    { packId: PACK, lang: 'en' },
    { packId: OTHER, lang: 'en', withoutDeck: true },
  ]);
  try {
    const ana = await w.t.registerUser();
    const count = () =>
      (w.t.db.prepare('SELECT COUNT(*) AS n FROM decks_decks').get() as { n: number }).n;
    for (const body of [
      { packId: 'not-a-pack', lang: 'en' as const },
      { packId: 'sci26-g4-t1-w99', lang: 'en' as const },
      { packId: PACK, lang: 'fil' as const },
    ])
      assert.equal(
        (await w.t.call('decks.create', { body, token: ana.token })).status,
        404,
        JSON.stringify(body)
      );
    // Built content without a built deck: no copy without its drawings.
    const unbuilt = await w.t.call('decks.create', {
      body: { packId: OTHER, lang: 'en' },
      token: ana.token,
    });
    assert.equal(unbuilt.status, 503);
    assert.equal(unbuilt.error?.message, 'These slides are being rebuilt. Please try again later.');
    // A deck whose bytes do not match its manifest (a half-copied snapshot).
    const file = join(
      w.fx.options.artifactsDir,
      PACK,
      'en',
      `tala-${PACK.slice(6)}-en-slides.pptx`
    );
    const good = w.fx.variant(PACK, 'en').deck!;
    writeFileSync(file, Buffer.from('PK half a file'));
    assert.equal(
      (await w.t.call('decks.create', { body: { packId: PACK, lang: 'en' }, token: ana.token }))
        .status,
      503
    );
    writeFileSync(file, good);
    // Content on disk that is not the content the review record is about.
    const packFile = join(w.fx.options.libraryDir, PACK, 'en', 'pack.json');
    const content = JSON.stringify(w.fx.variant(PACK, 'en').content);
    writeFileSync(packFile, content.replace('"schemaVersion":1', '"schemaVersion": 1'));
    assert.equal(
      (await w.t.call('decks.create', { body: { packId: PACK, lang: 'en' }, token: ana.token }))
        .status,
      503
    );
    assert.equal(count(), 0, 'nothing was stored by the refused attempts');
    writeFileSync(packFile, content);
    assert.equal((await copy(w, ana)).deck.rev, 1);
    assert.equal(count(), 1);
    assert.deepEqual(w.t.errors, []);
  } finally {
    w.close();
  }
});

/** The pack pipeline's editability audit (packages/tala-packs/src/render/editability.ts), run on a teacher's download. */
function editabilityFindings(pptx: Uint8Array, slides: DeckSlide[]): string[] {
  const zip = readZip(pptx);
  const findings: string[] = [];
  const squash = (s: string) =>
    xmlUnescape(s)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '');
  const size = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(zip.text('ppt/presentation.xml'));
  const slideArea = Number(size![1]) * Number(size![2]);
  const parts = slideParts(zip);
  if (parts.length !== slides.length)
    findings.push(`deck has ${parts.length} slides, the copy ${slides.length}`);
  const fonts = new Set<string>();
  let lists = 0;
  for (const [i, part] of parts.entries()) {
    const xml = zip.text(part);
    const s = slides[i];
    const id = s?.id ?? `slide ${i + 1}`;
    const shapes = xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? [];
    const runs = shapes
      .flatMap((sp) => (sp.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((t) => t.slice(5, -6)))
      .filter((t) => t.trim());
    if (!runs.length) findings.push(`${id}: no editable text on the slide`);
    const shown = squash(runs.join(' '));
    if (s) {
      const drawn = [
        s.title,
        ...s.lines,
        ...(s.kind === 'check' || s.kind === 'question' ? s.choices : []),
      ];
      for (const w of drawn)
        if (squash(w) && !shown.includes(squash(w)))
          findings.push(`${id}: "${w.slice(0, 50)}" is not editable text on the slide`);
    }
    for (const pic of xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? []) {
      const ext = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(pic);
      const share = ext ? (Number(ext[1]) * Number(ext[2])) / slideArea : 0;
      if (share >= 0.5)
        findings.push(`${id}: a picture covers ${(share * 100).toFixed(0)}% of the slide`);
      if (!/descr="[^"]+"/.test(pic)) findings.push(`${id}: a picture has no alt text`);
    }
    lists += (xml.match(/<a:buAutoNum\b|<a:buChar\b/g) ?? []).length;
    for (const r of runs)
      if (/^\s*(?:•|●|▪)\s|^\s*\d{1,2}\s{2,}/.test(xmlUnescape(r)))
        findings.push(`${id}: typed list marker "${r.slice(0, 12)}"`);
    for (const m of xml.matchAll(/<a:(?:latin|ea|cs) typeface="([^"]+)"/g)) fonts.add(m[1]!);
    const notes = [...relationships(zip, part).values()].find((r) =>
      r.type.endsWith('/notesSlide')
    );
    if (!notes || !/<a:t>[^<]*\S/.test(zip.text(notes.target)))
      findings.push(`${id}: no editable speaker notes`);
  }
  if (!lists) findings.push('no native lists');
  for (const font of fonts)
    if (!['Cambria', 'Calibri', '+mj-lt', '+mn-lt'].includes(font))
      findings.push(`font ${font} is not one of the deck fonts`);
  return findings;
}

test('the download is a real, editable PowerPoint file of the edited copy', { skip }, async () => {
  const w = world();
  try {
    const ana = await w.t.registerUser();
    const original = w.fx.variant(PACK, 'en');
    const made = await copy(w, ana);
    w.t.clock.advance({ minutes: 5 });
    const edits = teacherEdits(made.deck.slides);
    assert.equal((await save(w, ana, made.deck.id, 1, edits.slides)).ok, true);

    const { res, bytes } = await bytesOf(w, ana, `/decks/${made.deck.id}/pptx`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), PPTX_CONTENT_TYPE);
    assert.equal(
      res.headers.get('content-disposition'),
      `attachment; filename="tala-${PACK.slice(6)}-en-my-copy.pptx"`
    );
    assert.deepEqual(
      Buffer.from((await bytesOf(w, ana, `/decks/${made.deck.id}/pptx`)).bytes),
      Buffer.from(bytes),
      'the same saved copy always downloads as the same bytes'
    );

    // It opens: with this module's reader and with an independent one; every XML part is well-formed.
    const zip = readZip(bytes);
    assert.deepEqual(Object.keys(unzipSync(bytes)), zip.names);
    assert.equal(zip.names[0], '[Content_Types].xml');
    for (const name of zip.names.filter((n) => /\.(xml|rels)$/.test(n)))
      assert.equal(xmlProblem(zip.text(name)), null, name);

    // Her slides, in her order, with her words as real text.
    const parts = slideParts(zip);
    assert.equal(parts.length, edits.slides.length);
    const titleOf = (xml: string) => {
      const shape =
        (xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? []).find((sp) => sp.includes('type="title"')) ??
        '';
      return xmlUnescape([...shape.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(''));
    };
    assert.deepEqual(
      parts.map((p) => titleOf(zip.text(p))),
      edits.slides.map((s) => s.title)
    );
    const at = (id: string) => zip.text(parts[edits.slides.findIndex((s) => s.id === id)]!);
    assert.ok(
      at(edits.editedId).includes(
        '<a:t>Example from our barangay: the carabao pulls the cart with a rope.</a:t>'
      )
    );
    assert.ok(
      at(edits.duplicate.id).includes(
        '<a:t>Example from our barangay: the carabao pulls the cart with a rope.</a:t>'
      )
    );
    const added = at(edits.added.id);
    assert.equal(
      (added.match(/<a:buAutoNum type="arabicPeriod"\/>/g) ?? []).length,
      edits.added.lines.length,
      'her activity steps are a native numbered list'
    );
    for (const line of edits.added.lines) assert.ok(added.includes(`<a:t>${line}</a:t>`));
    const notesOf = (id: string) => {
      const part = parts[edits.slides.findIndex((s) => s.id === id)]!;
      return zip.text(
        [...relationships(zip, part).values()].find((r) => r.type.endsWith('/notesSlide'))!.target
      );
    };
    assert.ok(
      notesOf(edits.editedId).includes(
        '<a:t>My note: ask the class for their own example first.</a:t>'
      ),
      'her own note is in the speaker notes'
    );
    assert.ok(
      notesOf(edits.added.id).includes('Five minutes. Walk around and look at each group.')
    );
    const everything = parts.map((p) => zip.text(p)).join('');
    assert.equal(parts.length, made.deck.slides.length + 1, 'two slides added, one deleted');

    // The same promises the pack pipeline audits on every deck it builds.
    assert.deepEqual(editabilityFindings(bytes, edits.slides), []);

    // Honest labels travel with the copy: draft on the cover, draft + edited + art credit on the credits slide.
    assert.ok(zip.text(parts[0]!).includes('DRAFT — not yet reviewed by a teacher'));
    const credits = zip.text(parts[edits.slides.findIndex((s) => s.kind === 'credits')]!);
    for (const line of [
      'Draft: checked automatically and by a second AI model; not yet reviewed by a teacher',
      'This copy was edited by its teacher; the edits were not checked by Hiraia',
      'Drawings © Hiraia',
    ])
      assert.ok(credits.includes(line), line);

    // Pictures: only her copy's drawings and the two brand marks, each embedded exactly as stored (watermark intact).
    const brand = [
      sha(Buffer.from(GLYPH_PNG_BASE64, 'base64')),
      sha(Buffer.from(WORDMARK_PNG_BASE64, 'base64')),
    ];
    const known = new Set([...made.deck.media.map((m) => m.sha256), ...brand]);
    const mediaParts = zip.names.filter((n) => n.startsWith('ppt/media/'));
    for (const name of mediaParts)
      assert.ok(
        known.has(sha(zip.read(name))),
        `${name} is a drawing of this copy or a brand mark`
      );
    const embedded = readDeckDrawings(bytes);
    assert.ok(embedded.size > 0);
    for (const [slug, d] of embedded)
      assert.equal(
        d.sha256,
        original.drawings.get(slug)!.sha256,
        `${slug}: the bytes the original deck embeds`
      );
    assert.ok(everything.includes('descr="Hiraia glyph"') && everything.includes('descr="Tala"'));

    // A Filipino copy exports with Filipino labels and language tags.
    const fil = await copy(w, ana, PACK, 'fil');
    const filDeck = readZip((await bytesOf(w, ana, `/decks/${fil.deck.id}/pptx`)).bytes);
    const filParts = slideParts(filDeck);
    assert.equal(filParts.length, fil.deck.slides.length);
    assert.ok(
      filDeck.text(filParts[0]!).includes('lang="fil-PH"') &&
        filDeck.text(filParts[0]!).includes('DRAFT — hindi pa na-review ng teacher')
    );
    assert.ok(
      !filDeck.text(filParts[filParts.length - 1]!).includes('In-edit ng teacher ang kopyang ito'),
      'an untouched copy is not called edited'
    );
    assert.deepEqual(
      editabilityFindings(
        (await bytesOf(w, ana, `/decks/${fil.deck.id}/pptx`)).bytes,
        fil.deck.slides
      ),
      []
    );
    assert.deepEqual(w.t.errors, []);
  } finally {
    w.close();
  }
});

test(
  'copying follows the library’s own rules about who may open a pack; a copy outlives them',
  { skip },
  async () => {
    const w = world(
      [
        { packId: PACK, lang: 'en' },
        { packId: OTHER, lang: 'en', publication: 'approved' },
      ],
      true
    );
    const saved = {
      reviewers: process.env.TALA_PACK_REVIEWERS,
      preview: process.env.TALA_PACK_DRAFT_PREVIEW,
    };
    try {
      delete process.env.TALA_PACK_REVIEWERS;
      delete process.env.TALA_PACK_DRAFT_PREVIEW;
      assert.equal(w.t.config.environment, 'production');
      const ana = await w.t.registerUser();
      // A draft is closed to an ordinary account in production, so it cannot be copied either.
      const denied = await w.t.call('decks.create', {
        body: { packId: PACK, lang: 'en' },
        token: ana.token,
      });
      assert.equal(denied.status, 404);
      assert.equal(
        denied.error?.message,
        'This pack is still being reviewed and is not available yet.'
      );
      // An approved pack can be copied by any signed-in teacher; its copy says who reviewed the original.
      const approved = await copy(w, ana, OTHER);
      assert.equal(approved.deck.sourceApproved, true);
      assert.equal(approved.deck.credits.reviewer, 'Test Teacher');
      const approvedDeck = readZip(
        (await bytesOf(w, ana, `/decks/${approved.deck.id}/pptx`)).bytes
      );
      const approvedParts = slideParts(approvedDeck);
      assert.ok(
        !approvedDeck.text(approvedParts[0]!).includes('DRAFT'),
        'no draft label on a copy of an approved pack'
      );
      const credits = approvedDeck.text(approvedParts[approvedParts.length - 1]!);
      assert.ok(credits.includes('Reviewed by Test Teacher'));
      assert.ok(
        !credits.includes('This copy was edited by its teacher'),
        'an untouched copy is not called edited'
      );
      // Once she changes a word, the copy says so: the review was of the original, not of her edit.
      const touched = structuredClone(approved.deck.slides);
      touched[1]!.title = `${touched[1]!.title} (mine)`;
      const savedEdit = await w.t.call('decks.save', {
        params: { deckId: approved.deck.id },
        body: { baseRev: approved.deck.rev, slides: touched },
        token: ana.token,
      });
      assert.equal(savedEdit.status, 200);
      const editedDeck = readZip((await bytesOf(w, ana, `/decks/${approved.deck.id}/pptx`)).bytes);
      const editedParts = slideParts(editedDeck);
      assert.ok(
        editedDeck
          .text(editedParts[editedParts.length - 1]!)
          .includes('This copy was edited by its teacher; the edits were not checked by Hiraia')
      );
      // The early preview opens drafts to signed-in accounts...
      process.env.TALA_PACK_DRAFT_PREVIEW = 'signed-in';
      const draft = await copy(w, ana);
      assert.equal(draft.deck.sourceApproved, false);
      assert.deepEqual(draft.original, { available: true, updated: false });
      // ...and when it closes again, the copy is still hers: readable, downloadable, but not resettable.
      delete process.env.TALA_PACK_DRAFT_PREVIEW;
      assert.deepEqual((await get(w, ana, draft.deck.id)).original, {
        available: false,
        updated: false,
      });
      assert.equal((await bytesOf(w, ana, `/decks/${draft.deck.id}/pptx`)).res.status, 200);
      assert.equal(
        (await w.t.call('decks.reset', { params: { deckId: draft.deck.id }, token: ana.token }))
          .status,
        404
      );
      assert.equal((await copy(w, ana)).deck.id, draft.deck.id);
      assert.deepEqual(w.t.errors, []);
    } finally {
      for (const [k, v] of [
        ['TALA_PACK_REVIEWERS', saved.reviewers],
        ['TALA_PACK_DRAFT_PREVIEW', saved.preview],
      ] as const)
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      w.close();
    }
  }
);

test(
  'deleting a copy or an account removes its decks; joining accounts moves them',
  { skip },
  async () => {
    const w = world();
    try {
      const rows = (owner: string) =>
        (
          w.t.db.prepare('SELECT COUNT(*) AS n FROM decks_decks WHERE owner_id = ?').get(owner) as {
            n: number;
          }
        ).n;
      const media = () =>
        (w.t.db.prepare('SELECT COUNT(*) AS n FROM decks_media').get() as { n: number }).n;
      const ana = await w.t.registerUser();
      const ben = await w.t.registerUser();
      const anaEn = await copy(w, ana);
      const anaFil = await copy(w, ana, PACK, 'fil');
      const benEn = await copy(w, ben);
      assert.equal(rows(ana.id), 2);
      assert.ok(media() > 0);

      // Deleting one copy leaves the other and Ben's alone.
      const gone = await w.t.call('decks.delete', {
        params: { deckId: anaFil.deck.id },
        token: ana.token,
      });
      assert.deepEqual(gone.data, { ok: true });
      assert.equal(
        (await w.t.call('decks.get', { params: { deckId: anaFil.deck.id }, token: ana.token }))
          .status,
        404
      );
      assert.equal(
        (await w.t.call('decks.delete', { params: { deckId: anaFil.deck.id }, token: ana.token }))
          .status,
        404
      );
      assert.equal(rows(ana.id), 1);
      assert.equal(rows(ben.id), 1);

      // Ana joins her old account (Ben's, in this story) into hers: his copies become hers, none is lost.
      w.t.clock.advance({ minutes: 5 });
      const edited = structuredClone(benEn.deck.slides);
      edited[2]!.title = 'From my old account';
      assert.equal((await save(w, ben, benEn.deck.id, 1, edited)).ok, true);
      await w.t.ok('account.merge', {
        token: ana.token,
        body: {
          confirm: 'MERGE',
          currentPassword: ana.password,
          email: ben.email,
          password: ben.password,
        },
      });
      assert.equal(rows(ben.id), 0);
      assert.equal(rows(ana.id), 2);
      const list = await w.t.ok('decks.list', { token: ana.token });
      assert.deepEqual(list.decks.map((d) => d.id).sort(), [anaEn.deck.id, benEn.deck.id].sort());
      assert.equal((await get(w, ana, benEn.deck.id)).deck.slides[2]!.title, 'From my old account');
      assert.equal(
        (await copy(w, ana)).deck.id,
        benEn.deck.id,
        '"my copy" answers the one changed most recently'
      );
      assert.equal(
        (await w.t.call('decks.list', { token: ben.token })).status,
        401,
        'the joined account is gone'
      );

      // Deleting the account removes every copy and the drawings nothing shows any more.
      const deleted = await w.t.call('account.delete', {
        token: ana.token,
        body: { confirm: 'DELETE', password: ana.password },
      });
      assert.equal(deleted.ok, true);
      assert.equal(rows(ana.id), 0);
      assert.equal(
        (w.t.db.prepare('SELECT COUNT(*) AS n FROM decks_decks').get() as { n: number }).n,
        0
      );
      assert.equal(media(), 0);
      assert.deepEqual(w.t.errors, []);
    } finally {
      w.close();
    }
  }
);

test(
  'the module’s lifecycle hooks are safe to repeat and touch only their own account',
  { skip },
  async () => {
    const w = world();
    try {
      const ana = await w.t.registerUser();
      const ben = await w.t.registerUser();
      await copy(w, ana);
      const bens = await copy(w, ben);
      const mod = createDecksModule(w.fx.options);
      const deps = {
        db: w.t.db,
        config: w.t.config,
        now: w.t.clock.now,
        newId: () => 'unused',
        log: { info() {}, warn() {}, error() {} },
      };
      w.t.db.transaction(() => mod.onAccountDeleted!(deps, 'nobody'))();
      w.t.db.transaction(() => mod.onAccountMerged!(deps, 'nobody', ana.id))();
      assert.equal((await w.t.ok('decks.list', { token: ana.token })).decks.length, 1);
      w.t.db.transaction(() => mod.onAccountDeleted!(deps, ana.id))();
      w.t.db.transaction(() => mod.onAccountDeleted!(deps, ana.id))();
      assert.deepEqual((await w.t.ok('decks.list', { token: ana.token })).decks, []);
      assert.equal((await get(w, ben, bens.deck.id)).deck.id, bens.deck.id);
      assert.equal(
        (await bytesOf(w, ben, `/decks/${bens.deck.id}/media/${bens.deck.media[0]!.slug}`)).res
          .status,
        200,
        'drawings another copy still shows are kept'
      );
      assert.deepEqual(w.t.errors, []);
    } finally {
      w.close();
    }
  }
);

test(
  'drawings and previews may be kept on the device for a while; decks and files never',
  { skip },
  async () => {
    const w = world();
    try {
      const ana = await w.t.registerUser();
      const made = await copy(w, ana);
      const slug = made.deck.media[0]!.slug;
      const mine = await bytesOf(w, ana, `/decks/${made.deck.id}/media/${slug}`);
      assert.equal(mine.res.status, 200);
      assert.equal(mine.res.headers.get('cache-control'), 'private, max-age=86400');
      const shared = await bytesOf(w, ana, `/packs/${PACK}/media/${slug}?lang=en`);
      assert.equal(shared.res.status, 200);
      assert.equal(shared.res.headers.get('cache-control'), 'private, max-age=86400');
      const preview = await bytesOf(w, ana, `/packs/${PACK}/previews/1?lang=en`);
      if (preview.res.status === 200)
        assert.equal(preview.res.headers.get('cache-control'), 'private, max-age=3600');
      // Never a shared cache, and nothing a teacher wrote: the deck itself and its PowerPoint are not stored.
      const pptx = await bytesOf(w, ana, `/decks/${made.deck.id}/pptx`);
      assert.equal(pptx.res.headers.get('cache-control'), 'no-store');
      const json = await w.t.request('GET', `/decks/${made.deck.id}`, { token: ana.token });
      assert.equal(json.headers.get('cache-control'), 'no-store');
      const refused = await bytesOf(w, null, `/decks/${made.deck.id}/media/${slug}`);
      assert.equal(refused.res.status, 401);
      assert.equal(refused.res.headers.get('cache-control'), 'no-store');
    } finally {
      w.close();
    }
  }
);
