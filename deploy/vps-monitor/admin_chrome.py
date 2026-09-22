"""Shared cream observatory chrome for every authenticated pilot admin page."""
import html

NAV = (
    ("/", "Observatory", "home"),
    ("/tala-reports", "Tala reports", "tala-reports"),
    ("/archive/telemetry", "Detailed reports", "telemetry"),
    ("/archive/training", "Training", "training"),
)

CSS = """
:root{--ink:#1c3b2e;--muted:#617060;--paper:#faf7ef;--stock:#f4ead5;--line:#dedfd3;--gold:#d8a03a;--green:#e7efdf;--teal:#2f6360;--crit:#973e27}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,sans-serif;min-height:100vh}
button,a,input,select{font:inherit}button,a{touch-action:manipulation}button{cursor:pointer;color:var(--ink)}
button:focus-visible,a:focus-visible,select:focus-visible{outline:3px solid var(--gold);outline-offset:4px}
a{color:inherit}
.wrap{max-width:1320px;margin:auto;padding:32px 36px 72px}
.top{display:flex;gap:24px;align-items:center;border-bottom:1px solid var(--line);padding-bottom:24px;flex-wrap:wrap}
.brand{font:bold 34px Georgia,serif;letter-spacing:-2px}
.brand i{color:var(--gold);font-style:normal}
.eyebrow{font-size:10px;font-weight:750;letter-spacing:2px;text-transform:uppercase;color:var(--muted)}
.top nav,.admin-nav{margin-left:auto;display:flex;align-items:center;gap:18px;font-size:12px;flex-wrap:wrap}
.top nav a[aria-current=page],.admin-nav a[aria-current=page]{font-weight:750;text-decoration:underline;text-underline-offset:4px;text-decoration-color:var(--gold)}
.top form,.admin-nav form{margin:0}
.plain{background:transparent;border:0;padding:8px 0;text-decoration:underline}
h1{font:38px/1.1 Georgia,serif;margin:6px 0 12px}
h2{font:22px/1.2 Georgia,serif;margin:28px 0 12px}
.lede,.muted{color:var(--muted)}
.lede{margin:18px 0 8px;font-size:14px;max-width:62rem}
.toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:18px 0}
.toolbar .status{margin:0;flex:1;font-size:13px;color:var(--muted);min-height:20px}
.refresh,select,.btn{background:white;border:1px solid var(--line);border-radius:7px;padding:10px 16px;font-size:13px}
.btn-danger{background:transparent;border:1px solid #e4c4bc;color:var(--crit)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:12px;margin:14px 0}
.tile,.panel,.report{background:#fffef9;border:1px solid var(--line);border-radius:10px;padding:18px}
.tile .value{font:30px/1.15 Georgia,serif;letter-spacing:-1px}
.tile .label,.kicker{font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:var(--muted);font-weight:650}
.report{margin:14px 0}
.report h2{font-size:18px;margin:8px 0}
.report .details{white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0}
.report .media a{color:var(--teal);font-weight:650}
.report .note{font-size:12px;color:var(--muted)}
.report-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
table{border-collapse:collapse;width:100%;font-size:14px}
td,th{text-align:left;border-bottom:1px solid var(--line);padding:9px;vertical-align:top}
section{margin:22px 0;overflow:auto}
.status.error{color:var(--crit)}
.foot{margin-top:28px;font-size:11px;color:var(--muted)}
@media(max-width:560px){.wrap{padding:20px 14px 40px}.top nav,.admin-nav{margin-left:0;width:100%}}
"""


def nav(mount, csrf, active):
    mount = mount.rstrip("/") or "/admin"
    links = []
    for path, label, key in NAV:
        href = mount + "/" if path == "/" else mount + path
        current = ' aria-current="page"' if key == active else ""
        links.append(f'<a href="{html.escape(href, quote=True)}"{current}>{html.escape(label)}</a>')
    logout = (
        f'<form method="post" action="{html.escape(mount, quote=True)}/logout">'
        f'<input type="hidden" name="csrf" value="{html.escape(csrf, quote=True)}">'
        f'<button type="submit" class="plain">Sign out</button></form>'
    )
    return f'<nav class="admin-nav">{"".join(links)}{logout}</nav>'


def wrap(title, eyebrow, active, mount, csrf, body):
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>{html.escape(title)} · Hiraia</title><style>{CSS}</style></head><body>'
        f'<main class="wrap"><header class="top"><div class="brand">hiraia<i>.</i></div>'
        f'<div class="eyebrow">{html.escape(eyebrow)}</div>{nav(mount, csrf, active)}</header>'
        f'{body}</main></body></html>'
    )
