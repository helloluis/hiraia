#!/usr/bin/env python3
"""Tiny zero-dependency review UI for human-scoring eval responses.

Shows every (run x prompt) response with the student prompt, the model reply,
and the cheap auto-scores; lets you thumbs-up / thumbs-down each one (plus an
optional note). Ratings persist to eval.db (responses.human_thumb, human_notes).

  python3 review_app.py           # serves http://127.0.0.1:8000
  python3 review_app.py 8080      # custom port

Keyboard: j/k or arrows = move, f = 👍 good, d = 👎 bad (auto-advances),
          x = clear rating, / = focus filter. Click works too.
"""
import json, sqlite3, sys, os, html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "eval.db")


def conn():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    return c


def ensure_schema():
    c = conn()
    cols = [r[1] for r in c.execute("PRAGMA table_info(responses)")]
    if "human_thumb" not in cols:
        c.execute("ALTER TABLE responses ADD COLUMN human_thumb INTEGER")  # 1=up 0=down NULL=unrated
        c.commit()
    c.close()


def fetch_rows():
    c = conn()
    rows = c.execute("""
        SELECT r.id, r.run_id, r.reply, r.words, r.lang_ok, r.repetitive,
               r.english_heavy, r.ends_question, r.too_short,
               r.human_thumb, r.human_notes,
               p.prompt_id, p.lang, p.grade, p.register, p.topic, p.prompt
        FROM responses r JOIN prompts p ON p.prompt_id = r.prompt_id
        ORDER BY r.run_id, p.lang, p.grade, p.prompt_id
    """).fetchall()
    c.close()
    return [dict(x) for x in rows]


PAGE = """<!doctype html><html><head><meta charset="utf-8">
<title>Hiraia eval review</title>
<style>
 :root{--bg:#0f1115;--card:#1a1d24;--mut:#8a93a6;--up:#2ecc71;--down:#e74c3c;--sel:#3b82f6}
 *{box-sizing:border-box} body{margin:0;background:var(--bg);color:#e6e9ef;font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif}
 header{position:sticky;top:0;background:#0f1115ee;backdrop-filter:blur(6px);padding:12px 18px;border-bottom:1px solid #262a33;z-index:10}
 h1{font-size:16px;margin:0 0 8px} .bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
 .chip{background:#222632;border:1px solid #2f3441;color:#cfd5e1;padding:4px 10px;border-radius:14px;cursor:pointer;font-size:13px}
 .chip.on{background:var(--sel);border-color:var(--sel);color:#fff}
 .prog{margin-left:auto;color:var(--mut);font-size:13px} .prog b{color:#e6e9ef}
 input#flt{background:#222632;border:1px solid #2f3441;color:#fff;padding:5px 10px;border-radius:8px;width:220px}
 main{max-width:920px;margin:18px auto;padding:0 16px;display:flex;flex-direction:column;gap:12px}
 .card{background:var(--card);border:1px solid #262a33;border-left:4px solid #262a33;border-radius:10px;padding:14px 16px}
 .card.up{border-left-color:var(--up)} .card.down{border-left-color:var(--down)}
 .card.sel{outline:2px solid var(--sel)}
 .meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;color:var(--mut);font-size:12px;margin-bottom:8px}
 .tag{background:#222632;border-radius:6px;padding:1px 7px} .run{color:#a9b4cc;font-weight:600}
 .warn{color:#e67e22} .ok{color:#2ecc71}
 .q{color:#9fd0ff;margin:2px 0 8px;font-weight:600}
 .a{white-space:pre-wrap;background:#14171d;border-radius:8px;padding:10px 12px;font-size:14.5px}
 .acts{display:flex;gap:8px;margin-top:10px;align-items:center}
 button.t{font-size:18px;border:1px solid #2f3441;background:#222632;color:#cfd5e1;border-radius:8px;padding:4px 14px;cursor:pointer}
 button.t.up.act{background:var(--up);border-color:var(--up);color:#06210f}
 button.t.down.act{background:var(--down);border-color:var(--down);color:#2a0a06}
 .note{flex:1;background:#14171d;border:1px solid #2f3441;color:#dfe4ee;border-radius:8px;padding:5px 10px;font-size:13px}
 .hint{color:var(--mut);font-size:12px;margin-left:6px}
</style></head><body>
<header>
 <h1>Hiraia eval review &mdash; thumbs-up / thumbs-down each reply</h1>
 <div class="bar">
   <span id="runchips"></span>
   <input id="flt" placeholder="filter text / type… (press /)">
   <label class="hint"><input type="checkbox" id="unr"> unrated only</label>
   <span class="prog">rated <b id="ndone">0</b>/<b id="ntot">0</b> · <span id="updown"></span></span>
 </div>
 <div class="hint">keys: j/k move · f 👍 · d 👎 · x clear · / filter</div>
</header>
<main id="list"></main>
<script>
const DATA = __DATA__;
let runFilter = null, sel = 0;
const $ = s => document.querySelector(s);

function runs(){ return [...new Set(DATA.map(r=>r.run_id))]; }
function visible(){
  const q = $('#flt').value.trim().toLowerCase();
  const unr = $('#unr').checked;
  return DATA.filter(r=>{
    if(runFilter && r.run_id!==runFilter) return false;
    if(unr && r.human_thumb!==null && r.human_thumb!==undefined) return false;
    if(q){ const hay=(r.prompt+' '+r.reply+' '+r.register+' '+r.run_id+' '+(r.human_notes||'')).toLowerCase(); if(!hay.includes(q)) return false; }
    return true;
  });
}
function badge(r){
  const b=[];
  b.push(`<span class="tag">${r.words}w</span>`);
  b.push(r.lang_ok?`<span class="tag ok">lang✓</span>`:`<span class="tag warn">lang✗</span>`);
  if(r.repetitive) b.push(`<span class="tag warn">repetitive</span>`);
  if(r.english_heavy) b.push(`<span class="tag warn">eng-heavy</span>`);
  if(r.too_short) b.push(`<span class="tag warn">short</span>`);
  if(r.ends_question) b.push(`<span class="tag ok">Socratic?</span>`);
  return b.join('');
}
function render(){
  const v = visible();
  $('#ntot').textContent = DATA.length;
  $('#ndone').textContent = DATA.filter(r=>r.human_thumb===0||r.human_thumb===1).length;
  const up=DATA.filter(r=>r.human_thumb===1).length, dn=DATA.filter(r=>r.human_thumb===0).length;
  $('#updown').textContent = `👍 ${up} · 👎 ${dn}`;
  // run chips
  $('#runchips').innerHTML = `<span class="chip ${!runFilter?'on':''}" data-run="">all</span>` +
    runs().map(rn=>`<span class="chip ${runFilter===rn?'on':''}" data-run="${rn}">${rn}</span>`).join('');
  document.querySelectorAll('.chip').forEach(c=>c.onclick=()=>{runFilter=c.dataset.run||null;sel=0;render();});
  if(sel>=v.length) sel=Math.max(0,v.length-1);
  $('#list').innerHTML = v.map((r,i)=>{
    const cls = r.human_thumb===1?'up':r.human_thumb===0?'down':'';
    return `<div class="card ${cls} ${i===sel?'sel':''}" data-id="${r.id}" data-i="${i}">
      <div class="meta"><span class="run">${r.run_id}</span><span class="tag">${r.lang}</span>
        <span class="tag">grade ${r.grade}</span><span class="tag">${r.register}</span>
        <span class="tag">${r.topic||''}</span>${badge(r)}</div>
      <div class="q">${esc(r.prompt)}</div>
      <div class="a">${esc(r.reply)||'<i>(empty)</i>'}</div>
      <div class="acts">
        <button class="t down ${r.human_thumb===0?'act':''}" data-th="0">👎</button>
        <button class="t up ${r.human_thumb===1?'act':''}" data-th="1">👍</button>
        <input class="note" placeholder="note (optional)" value="${esc(r.human_notes||'')}">
      </div></div>`;
  }).join('');
  // wire buttons
  document.querySelectorAll('.card').forEach(card=>{
    const id=+card.dataset.id, i=+card.dataset.i;
    card.querySelectorAll('button.t').forEach(b=>b.onclick=()=>{sel=i;rate(id,+b.dataset.th);});
    card.querySelector('.note').onblur=e=>saveNote(id,e.target.value);
    card.onclick=e=>{ if(!e.target.closest('button,input')){sel=i;render();} };
  });
  const cur=document.querySelector('.card.sel'); if(cur) cur.scrollIntoView({block:'nearest'});
}
function esc(s){ return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function find(id){ return DATA.find(r=>r.id===id); }
async function rate(id, thumb){
  const r=find(id); r.human_thumb = (r.human_thumb===thumb)?null:thumb; // toggle off if same
  await post({id, thumb:r.human_thumb});
  // auto-advance to next when newly rated
  if(r.human_thumb!==null){ sel=Math.min(visible().length-1, sel+1); }
  render();
}
async function saveNote(id, note){ const r=find(id); r.human_notes=note; await post({id, note}); }
async function post(body){
  try{ await fetch('/rate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); }
  catch(e){ alert('save failed: '+e); }
}
document.addEventListener('keydown', e=>{
  if(e.target.tagName==='INPUT'){ if(e.key==='Escape') e.target.blur(); return; }
  const v=visible(); if(!v.length) return;
  if(e.key==='j'||e.key==='ArrowDown'){sel=Math.min(v.length-1,sel+1);render();e.preventDefault();}
  else if(e.key==='k'||e.key==='ArrowUp'){sel=Math.max(0,sel-1);render();e.preventDefault();}
  else if(e.key==='f'){rate(v[sel].id,1);}
  else if(e.key==='d'){rate(v[sel].id,0);}
  else if(e.key==='x'){const r=v[sel]; r.human_thumb=null; post({id:r.id,thumb:null}); render();}
  else if(e.key==='/'){$('#flt').focus();e.preventDefault();}
});
$('#flt').addEventListener('input',()=>{sel=0;render();});
$('#unr').addEventListener('change',()=>{sel=0;render();});
render();
</script></body></html>"""


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def _send(self, code, body, ctype="text/html; charset=utf-8"):
        b = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            data = json.dumps(fetch_rows(), ensure_ascii=False)
            self._send(200, PAGE.replace("__DATA__", data))
        else:
            self._send(404, "not found")

    def do_POST(self):
        if self.path != "/rate":
            return self._send(404, "not found")
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or "{}")
        rid = body.get("id")
        c = conn()
        if "thumb" in body:
            c.execute("UPDATE responses SET human_thumb=? WHERE id=?", (body["thumb"], rid))
        if "note" in body:
            c.execute("UPDATE responses SET human_notes=? WHERE id=?", (body["note"], rid))
        c.commit(); c.close()
        self._send(200, json.dumps({"ok": True}), "application/json")


def main():
    ensure_schema()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    n = len(fetch_rows())
    print(f"Review UI: http://127.0.0.1:{port}  ({n} responses)  — Ctrl+C to stop")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
