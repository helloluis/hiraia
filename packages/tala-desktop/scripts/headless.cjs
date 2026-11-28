// Private X server, dynamic display allocation; no machine-wide configuration.
const { spawn } = require('node:child_process');
const server = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1440x1000x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'inherit', 'pipe'] });
server.stdio[3].once('data', value => {
  const child = spawn(process.execPath, process.argv.slice(2), { stdio: 'inherit', env: { ...process.env, DISPLAY: ':' + value.toString().trim() } });
  child.on('exit', code => { server.kill(); process.exitCode = code ?? 1; });
});
server.on('error', error => { console.error(error); process.exitCode = 1; });
