import { type NextRequest } from 'next/server';
import { DONATION_CHAINS } from '@/components/donate/config';
import { checkReportAuth, reportRows } from '@/server/donations';

// GET /api/donations/report — Luis's private list of confirmed checkout donations (identified and
// anonymous). HTTP Basic auth: any username, the password whose SHA-256 is
// DONATIONS_REPORT_PASSWORD_SHA256. ?format=csv for a spreadsheet.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const PRIVATE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function GET(req: NextRequest) {
  if (!checkReportAuth(req.headers.get('authorization')))
    return new Response('Authentication required', {
      status: 401,
      headers: { ...PRIVATE, 'WWW-Authenticate': 'Basic realm="Hiraia donations", charset="UTF-8"' },
    });
  const { rows, pending } = reportRows();
  const view = rows.map((r) => {
    const chain = DONATION_CHAINS.find((c) => c.id === r.chain_id);
    const tx = (JSON.parse(r.tx_hashes) as { transactionHash: string }[]).at(-1)?.transactionHash ?? '';
    return { when: r.confirmed_at + ' UTC' + (r.test ? ' (TEST)' : ''), email: r.email ?? 'anonymous', amount: r.amount, token: r.token_symbol,
      network: chain?.name ?? String(r.chain_id), tx, txUrl: tx && chain ? `${chain.explorer}/tx/${tx}` : '', notified: r.notified };
  });
  if (req.nextUrl.searchParams.get('format') === 'csv') {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const csv = ['confirmed_at,email,amount,token,network,tx_hash,notified', ...view.map((v) =>
      [v.when, v.email, v.amount, v.token, v.network, v.tx, v.notified].map(q).join(','))].join('\n');
    return new Response(csv + '\n', { headers: { ...PRIVATE, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="hiraia-donations.csv"' } });
  }
  const identified = view.filter((v) => v.email !== 'anonymous').length;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Hiraia donations</title><style>
body{font:15px/1.45 system-ui,sans-serif;margin:24px;color:#1C3B2E;background:#F4EAD5}table{border-collapse:collapse;width:100%;background:#fffdf7}
th,td{padding:8px 10px;border-bottom:1px solid #d9ccb0;text-align:left;vertical-align:top}th{background:#1C3B2E;color:#F4EAD5}
td.mono,a{font-family:ui-monospace,monospace;font-size:13px;word-break:break-all}p{max-width:60rem}</style></head><body>
<h1>Hiraia donations (thirdweb checkout)</h1>
<p>${view.length} confirmed checkout payment${view.length === 1 ? '' : 's'}, ${identified} with an email. ${pending} checkout${pending === 1 ? '' : 's'} with an email still waiting for payment (deleted after 7 days).
Emails are removed 180 days after the donation. Direct transfers to the address are not listed here. <a href="?format=csv">Download CSV</a></p>
<table><thead><tr><th>Confirmed</th><th>Email</th><th>Amount</th><th>Network</th><th>Transaction</th><th>Alert</th></tr></thead><tbody>
${view.map((v) => `<tr><td>${esc(v.when)}</td><td>${esc(v.email)}</td><td>${esc(v.amount)} ${esc(v.token)}</td><td>${esc(v.network)}</td>
<td>${v.txUrl ? `<a href="${esc(v.txUrl)}" rel="noopener noreferrer" target="_blank">${esc(v.tx)}</a>` : '—'}</td><td>${esc(v.notified)}</td></tr>`).join('\n') || '<tr><td colspan="6">No checkout donations yet.</td></tr>'}
</tbody></table></body></html>`;
  return new Response(html, { headers: { ...PRIVATE, 'Content-Type': 'text/html; charset=utf-8' } });
}
