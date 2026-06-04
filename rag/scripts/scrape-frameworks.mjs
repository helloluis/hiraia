#!/usr/bin/env node
/**
 * Scrape the open framework sources that are free to READ but PDF-gated:
 *   - NRC "A Framework for K-12 Science Education" (2012)  -> NAP read-online chapters
 *   - AAAS Project 2061 "Benchmarks for Science Literacy"  -> BSL online chapters
 *
 * Both are plain HTML (not JS apps), so a dependency-free fetch + tag-strip works.
 * Saves one .txt per chapter under sources/frameworks/<name>-text/.
 *
 *   cd rag && node scripts/scrape-frameworks.mjs
 */
import { mkdir, writeFile } from 'fs/promises';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const SOURCES = [
  { name: 'nrc',  max: 20, url: (n) => `https://nap.nationalacademies.org/read/13165/chapter/${n}` },
  { name: 'aaas', max: 16, url: (n) => `https://www.project2061.org/publications/bsl/online/index.php?chapter=${n}` },
];

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|br|tr|section|article)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n').map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

async function run() {
  for (const src of SOURCES) {
    const dir = `sources/frameworks/${src.name}-text`;
    await mkdir(dir, { recursive: true });
    let misses = 0, saved = 0, chars = 0;
    console.log(`\n=== ${src.name.toUpperCase()} ===`);
    for (let n = 1; n <= src.max && misses < 3; n++) {
      try {
        const res = await fetch(src.url(n), { headers: { 'User-Agent': UA } });
        if (!res.ok) { console.log(`  ch${n}: HTTP ${res.status}`); misses++; continue; }
        const text = htmlToText(await res.text());
        if (text.length < 1200) { console.log(`  ch${n}: thin (${text.length}) — skip`); misses++; continue; }
        misses = 0; saved++; chars += text.length;
        await writeFile(`${dir}/chapter-${String(n).padStart(2, '0')}.txt`, text);
        console.log(`  ✓ ch${n}: ${text.length.toLocaleString()} chars`);
      } catch (e) {
        console.log(`  ch${n}: error ${e.message}`); misses++;
      }
      await new Promise((r) => setTimeout(r, 1200)); // be polite
    }
    console.log(`  -> ${src.name}: ${saved} chapters, ${(chars / 1000).toFixed(0)}k chars`);
  }
}
run();
