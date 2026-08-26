#!/usr/bin/env bash
# Template-routing benchmark. Runs ON the pod. Serves a GGUF from HF on CPU, sends every probe
# in probes.json through /v1/chat/completions (real app system prompt per mode, templated user
# turn), N samples each at temperature T, labels each reply with fastText lid.176, uploads the
# raw results to <repo>/eval/misscard-<label>.json, self-terminates. A failure HOLDS the pod.
# Args: $1 hf-repo  $2 gguf-path  $3 label   env: SAMPLES (3) TEMP (0.7)
set -uo pipefail
. /root/env.sh
export CUDACXX=/usr/local/cuda/bin/nvcc PATH=/usr/local/cuda/bin:$PATH
REPO="${1:?}"; GGUF_PATH="${2:?}"; LABEL="${3:?}"; SAMPLES="${SAMPLES:-3}"; TEMP="${TEMP:-0.7}"
LOG=/root/eval.log; exec > >(tee -a $LOG) 2>&1
echo "=== MISS-CARD BENCH $LABEL  $REPO  samples=$SAMPLES T=$TEMP  $(date -u +%FT%TZ) ==="
hb(){ curl -s -m 10 -X POST https://hiraia.b11.dev/admin/api/hb -H "X-Token: $HB_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"pod_id\":\"$RUNPOD_POD_ID\",\"step\":${1:-0},\"loss\":0,\"total_steps\":${2:-0},\"kind\":\"$3\",\"phase\":\"$3\",\"note\":$(python3 -c "import json,sys;print(json.dumps(sys.argv[1][:600]))" "$4")}" >/dev/null 2>&1 || true; }
hold(){ T=$(grep -aiE "error|fatal|Traceback|assert" $LOG /root/build.log 2>/dev/null | tail -5 | tr '\n' ' | ' | tail -c 450); echo "HOLD: $*"; hb 0 0 held "MISSCARD $LABEL FAILED (pod HELD): $* :: $T"; exit 1; }
THREADS=$(python3 -c "
try:
    q,p=open('/sys/fs/cgroup/cpu.max').read().split(); print(max(2,int(int(q)/int(p))-2) if q!='max' else 16)
except Exception: print(16)")
( while [ ! -e /root/SERVING ]; do hb 0 0 boot "misscard $LABEL: build + pull"; sleep 45; done ) &
apt-get update -qq && apt-get install -y -qq cmake build-essential git >/dev/null 2>&1
command -v uv >/dev/null || pip install -q uv
[ -x /root/venv/bin/python ] || { uv venv --python 3.12 /root/venv >/dev/null 2>&1 && uv pip install -q --python /root/venv/bin/python huggingface_hub requests fasttext-wheel "numpy<2" || hold venv; }
PY=/root/venv/bin/python
mkdir -p /root/gguf
( HF_HOME=/root/hf $PY -c "
import os
from huggingface_hub import hf_hub_download
p=hf_hub_download('$REPO','$GGUF_PATH',token=os.environ['HF_TOKEN'],local_dir='/root/gguf'); print('GGUF:',p,os.path.getsize(p))" > /root/pull.log 2>&1 ) &
PULL=$!
( curl -sL -m 120 -o /root/lid.176.ftz https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.ftz && echo "lid.176.ftz $(stat -c %s /root/lid.176.ftz) bytes" ) &
LID=$!
[ -d /root/llama.cpp ] || git clone -q --depth 1 https://github.com/ggml-org/llama.cpp /root/llama.cpp
[ -x /root/llama.cpp/build/bin/llama-server ] || ( cd /root/llama.cpp && cmake -B build -DGGML_CUDA=OFF -DLLAMA_CURL=OFF > /root/build.log 2>&1 && cmake --build build --config Release -j "$THREADS" --target llama-server >> /root/build.log 2>&1 )
[ -x /root/llama.cpp/build/bin/llama-server ] || hold "llama-server not built"
wait $PULL; cat /root/pull.log; wait $LID; [ -s /root/lid.176.ftz ] || hold "lid.176.ftz download failed"
G=$(find /root/gguf -name "*.gguf" | head -1); [ -s "$G" ] || hold "GGUF missing"
/root/llama.cpp/build/bin/llama-server -m "$G" --port 8080 -c 2048 -t "$THREADS" -np 4 --jinja >/root/srv.log 2>&1 &
for i in $(seq 1 120); do curl -s localhost:8080/health 2>/dev/null | grep -q ok && break; sleep 2; done
curl -s localhost:8080/health | grep -q ok || hold "server never healthy"
touch /root/SERVING; echo ">> serving $G, $THREADS threads"

cat > /root/run.py <<'P'
import json, requests, sys, fasttext, re, time
from concurrent.futures import ThreadPoolExecutor
LABEL, SAMPLES, TEMP = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
SP=json.load(open("/root/system-prompts.json")); probes=json.load(open("/root/probes.json"))
lid=fasttext.load_model("/root/lid.176.ftz")
def label(text):
    t=re.sub(r"\s+"," ",text.replace("\n"," ")).strip()[:400]
    if not t: return "empty",0.0
    labs,probs=lid.predict(t,k=3)
    return labs[0].replace("__label__",""), float(probs[0])
def ask(mode,user):
    r=requests.post("http://localhost:8080/v1/chat/completions",timeout=300,json={
        "messages":[{"role":"system","content":SP[mode]},{"role":"user","content":user}],
        "max_tokens":160,"temperature":TEMP,"chat_template_kwargs":{"enable_thinking":False}})
    r.raise_for_status(); return r.json()["choices"][0]["message"].get("content") or ""
a=ask("tagalog",probes[0]["user_turn"]); assert a.strip(), "EMPTY self-check"; print("[selfcheck]",a[:70],label(a),flush=True)
jobs=[(p,s) for p in probes for s in range(SAMPLES)]
out=[]; done=0; t0=time.time()
def work(job):
    p,s=job
    try: ans=ask(p["mode"],p["user_turn"])
    except Exception as e: ans=f"<ERR {e}>"
    l,c=label(ans); return {**p,"sample":s,"answer":ans,"lid":l,"lid_conf":round(c,3)}
with ThreadPoolExecutor(max_workers=4) as ex:
    for r in ex.map(work,jobs):
        out.append(r); done+=1
        if done%50==0: print(f"[prog] {done}/{len(jobs)}  {(time.time()-t0)/done:.1f}s/each",flush=True)
empties=sum(1 for r in out if not r["answer"].strip() or r["answer"].startswith("<ERR"))
assert empties < len(out)*0.02, f"{empties} empty/error answers"
json.dump({"label":LABEL,"samples":SAMPLES,"temperature":TEMP,"n":len(out),"results":out},open(f"/root/routing-{LABEL}.json","w"),ensure_ascii=False)
EXP={"tagalog":"tl","cebuano":"ceb","english":"en"}
by={}
for r in out: by.setdefault(r["mode"],[]).append(r["lid"]==EXP[r["mode"]])
three=sum(1 for r in out if len([l for l in r["answer"].splitlines() if l.strip()])==3)
print("DONE", {m:f"{sum(v)}/{len(v)}" for m,v in by.items()}, f"| exactly-3-lines {three}/{len(out)} (retrievability scored locally)", flush=True)
P
TOTAL=$(python3 -c "import json;print(len(json.load(open('/root/probes.json')))*$SAMPLES)")
( while sleep 45; do N=$(grep -a "\[prog\]" $LOG | tail -1 | grep -oE "^\[prog\] [0-9]+" | grep -oE "[0-9]+$"); hb "${N:-0}" "$TOTAL" eval "misscard $LABEL: ${N:-0}/$TOTAL completions"; done ) & SIDE=$!
hb 0 "$TOTAL" eval "misscard $LABEL: running $TOTAL completions (x$SAMPLES, T=$TEMP)"
$PY /root/run.py "$LABEL" "$SAMPLES" "$TEMP"; RC=$?; kill $SIDE 2>/dev/null
[ $RC -eq 0 ] || hold "probe run failed"
$PY - <<P || hold "upload failed (results on pod)"
import os
from huggingface_hub import HfApi
HfApi(token=os.environ["HF_TOKEN"]).upload_file(path_or_fileobj="/root/misscard-$LABEL.json",path_in_repo="eval/misscard-$LABEL.json",repo_id="$REPO",commit_message="template-routing benchmark $LABEL (x$SAMPLES, T=$TEMP, fastText lid.176)")
print("UPLOADED")
P
SCORE=$(grep -a "^DONE" $LOG | tail -1 | cut -c6-)
hb 0 0 done "MISSCARD $LABEL COMPLETE — $SCORE"
touch /root/DEADMAN_CANCEL; sleep 15
curl -s -m 30 -X DELETE -H "Authorization: Bearer $RUNPOD_API_KEY" "https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID"
