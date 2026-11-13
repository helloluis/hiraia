const base = require('./app.json').expo;
const { applicationId } = require('./config.cjs');
module.exports = { ...base, android: { ...base.android, package: applicationId(process.env) } };
