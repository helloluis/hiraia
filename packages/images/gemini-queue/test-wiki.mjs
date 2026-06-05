import { writeFileSync } from 'node:fs';

async function searchWiki(query) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=6&format=json&origin=*`;
  const res = await fetch(url);
  const data = await res.json();
  return data.query?.search || [];
}

async function getImageUrl(fileTitle) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(fileTitle)}&prop=imageinfo&iiprop=url&format=json&origin=*`;
  const res = await fetch(url);
  const data = await res.json();
  const pages = data.query?.pages || {};
  for (const pageId in pages) {
    const page = pages[pageId];
    if (page.imageinfo && page.imageinfo[0]) {
      return page.imageinfo[0].url;
    }
  }
  return null;
}

async function main() {
  const query = "butterfly life cycle png";
  console.log(`Searching wiki for: "${query}"`);
  const results = await searchWiki(query);
  console.log(`Found ${results.length} results:`);
  for (const r of results.slice(0, 3)) {
    console.log(` - Title: ${r.title}`);
    const imgUrl = await getImageUrl(r.title);
    console.log(`   URL:   ${imgUrl}`);
  }
}

main().catch(err => console.error(err));
