const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
async function httpsFixture(handler) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tala-fixture-'));
  const key = path.join(temp, 'key.pem'), cert = path.join(temp, 'cert.pem');
  const config = path.join(temp, 'openssl.cnf');
  fs.writeFileSync(config, '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=Tala local test only\n[ext]\nsubjectAltName=DNS:tala.hiraia.org,DNS:localhost,IP:127.0.0.1\n');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-config', config, '-keyout', key, '-out', cert], { stdio: 'ignore' });
  const pub = execFileSync('openssl', ['x509', '-in', cert, '-pubkey', '-noout']);
  const der = execFileSync('openssl', ['pkey', '-pubin', '-outform', 'DER'], { input: pub });
  const pin = crypto.createHash('sha256').update(der).digest('base64');
  const requests = [];
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    requests.push({ method: req.method, path: req.url.split('?')[0], peer: req.socket.remoteAddress });
    handler(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { server, requests, port, origin: `https://127.0.0.1:${port}`, temp,
    // Only this ephemeral certificate is pinned for this process. No CA install,
    // global ignore-certificate-errors, or webSecurity/sandbox weakening.
    args: [`--ignore-certificate-errors-spki-list=${pin}`, '--no-proxy-server',
      `--host-resolver-rules=MAP tala.hiraia.org 127.0.0.1:${port}, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`, '--disable-background-networking'],
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(temp, { recursive: true, force: true }); },
  };
}
module.exports = { httpsFixture };
