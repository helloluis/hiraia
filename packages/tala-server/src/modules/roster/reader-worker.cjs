// TypeScript source packages are consumed directly, including inside the isolated worker.
require('tsx/cjs/api').register();
require('./reader-worker.ts');
