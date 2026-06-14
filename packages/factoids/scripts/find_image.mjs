import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const file = '/Users/luis/Code/hiraia/packages/images/index.json';
const data = JSON.parse(readFileSync(file, 'utf8'));

const query = process.argv[2] ? process.argv[2].toLowerCase() : '';
if (!query) {
  console.log('Usage: node find_image.mjs <keyword>');
  process.exit(0);
}

const matches = data.assets.filter(a => 
  a.id.toLowerCase().includes(query) || 
  a.name.toLowerCase().includes(query) ||
  a.tags.some(t => t.toLowerCase().includes(query)) ||
  a.searchText.toLowerCase().includes(query)
);

console.log(`Found ${matches.length} matching images for "${query}":`);
matches.forEach(m => {
  console.log(`- ID: ${m.id} | Subject: ${m.subject} | Name: ${m.name}`);
});
