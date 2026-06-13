import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const file = '/Users/luis/Code/hiraia/packages/images/index.json';
const data = JSON.parse(readFileSync(file, 'utf8'));

console.log(`Loaded ${data.count} image assets.`);
// Print all categories and a sample of IDs
const subjects = {};
data.assets.forEach(a => {
  subjects[a.subject] = (subjects[a.subject] || 0) + 1;
});

console.log('Subjects breakdown:', subjects);
console.log('\nFirst 50 asset IDs:');
console.log(data.assets.slice(0, 50).map(a => `${a.id} (${a.subject})`).join(', '));
