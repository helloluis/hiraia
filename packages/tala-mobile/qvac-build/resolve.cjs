const { createRequire } = require('node:module');
const path = require('node:path');
const isolatedRequire = createRequire(path.join(__dirname, 'package.json'));
module.exports = isolatedRequire;
