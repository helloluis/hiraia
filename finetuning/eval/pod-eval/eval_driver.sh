#!/usr/bin/env bash
# Pod-side eval driver for a merged Qwen3.5 GGUF: serve it with llama-server, run the routing /
# capability / gate probe sets over /v1/chat/completions, push the answers to HF, self-terminate.
#
# Runs ON the pod. Expects in /root: .hftok, env.sh (RUNPOD_POD_ID, RUNPOD_API_KEY, HB_TOKEN),
# system-prompts.json, routing.json, probes.json, cases.json.
#
# Args: $1 = HF repo holding the GGUF   $2 = path in repo   $3 = eval label (e.g. sft-v2)
#
# Every line below that looks odd cost a pod launch to learn (2026-08-26):
#   * CPU build. CUDA 12.4's nvcc has no Blackwell (compute 12.0); `native` resolves to "" and
#     the configure step dies. A 2B Q4_K_M decodes at ~47 tok/s on CPU — plenty for ~180 probes.
#   * -t = cgroup quota, NOT nproc. nproc reports the host (112); the quota was 24. 112 threads on
#     24 cores gave 0.05 tok/s during Gate 4.
#   * chat_template_kwargs.enable_thinking=false on EVERY request. With --jinja and thinking
#     undefined, llama-server leaves the <think> block OPEN, the model answers inside it, and every
#     `content` comes back "" with the text in `reasoning_content`. 141/141 answers were empty once.
#   * A failure HOLDS the pod (posts phase=held) and exits. It never deletes. The one time a driver
#     die()'d on a guard trip it destroyed the only copy of a successful run.
#   * Gate cases key the question as `question`, not `prompt`.
set -uo pipefail
. /root/env.sh
export CUDACXX=/usr/local/cuda/bin/nvcc PATH=/usr/local/cuda/bin:$PATH
REPO="${1:?hf repo}"; GGUF_PATH="${2:?path in repo}"; LABEL="${3:?label}"
LOG=/root/eval.log; exec > >(tee -a $LOG) 2>&1
echo "=== EVAL $LABEL  repo=$REPO  $(date -u +%FT%TZ) ==="

hb(){ curl -s -m 10 -X POST https://hiraia.b11.dev/admin/api/hb -H "X-Token: $HB_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"pod_id\":\"$RUNPOD_POD_ID\",\"step\":${1:-0},\"loss\":0,\"total_steps\":${2:-0},\"kind\":\"$3\",\"phase\":\"$3\",\"note\":$(python3 -c "import json,sys;print(json.dumps(sys.argv[1][:600]))" "$4")}" >/dev/null 2>&1 || true; }
hold(){ T=$(grep -aiE "error|fatal|Traceback|assert" $LOG /root/build.log 2>/dev/null | tail -5 | tr '\n' ' | ' | tail -c 450)
  echo "HOLD: $*"; hb 0 0 held "EVAL $LABEL FAILED (pod HELD): $* :: $T"; exit 1; }

# cgroup-safe thread count
THREADS=$(python3 -c "
try:
    q,p=open('/sys/fs/cgroup/cpu.max').read().split(); print(max(2,int(int(q)/int(p))-2) if q!='max' else 16)
except Exception: print(16)")
echo ">> threads=$THREADS (cgroup quota; nproc says $(nproc))"

( while [ ! -e /root/SERVING ]; do hb 0 0 boot "eval $LABEL: CPU llama.cpp build + GGUF pull"; sleep 45; done ) &
apt-get update -qq && apt-get install -y -qq cmake build-essential git >/dev/null 2>&1
command -v uv >/dev/null || pip install -q uv
[ -x /root/venv/bin/python ] || { uv venv --python 3.12 /root/venv >/dev/null 2>&1 && uv pip install -q --python /root/venv/bin/python huggingface_hub requests || hold venv; }
PY=/root/venv/bin/python
mkdir -p /root/gguf
# Pull the GGUF if the repo has one; otherwise pull the safetensors and CONVERT (--no-mtp, then
# Q4_K_M, then verify block_count == 24) and upload the GGUF back so the next run finds it.
( HF_HOME=/root/hf $PY - <<P
import os, sys
from huggingface_hub import hf_hub_download, HfApi, snapshot_download
api=HfApi(token=os.environ["HF_TOKEN"])
files=api.list_repo_files("$REPO")
if "$GGUF_PATH" in files:
    p=hf_hub_download("$REPO","$GGUF_PATH",token=os.environ["HF_TOKEN"],local_dir="/root/gguf"); print("GGUF:",p,os.path.getsize(p))
else:
    print("NO GGUF in repo — will convert from safetensors"); open("/root/NEED_CONVERT","w").write("$GGUF_PATH")
    snapshot_download("$REPO",token=os.environ["HF_TOKEN"],local_dir="/root/hfmodel",allow_patterns=["*.json","*.safetensors","*.jinja","tokenizer*"])
    print("safetensors pulled")
P
) > /root/pull.log 2>&1 &
PULL=$!
[ -d /root/llama.cpp ] || git clone -q --depth 1 https://github.com/ggml-org/llama.cpp /root/llama.cpp
if [ ! -x /root/llama.cpp/build/bin/llama-server ]; then
  ( cd /root/llama.cpp && cmake -B build -DGGML_CUDA=OFF -DLLAMA_CURL=OFF > /root/build.log 2>&1 \
    && cmake --build build --config Release -j "$THREADS" --target llama-server >> /root/build.log 2>&1 )
  [ -x /root/llama.cpp/build/bin/llama-server ] || hold "llama-server not built (see /root/build.log)"
fi
wait $PULL; cat /root/pull.log
if [ -e /root/NEED_CONVERT ]; then
  echo ">> converting safetensors -> GGUF (--no-mtp) -> Q4_K_M"
  [ -x /root/venv-conv/bin/python ] || { uv venv --python 3.12 /root/venv-conv >/dev/null 2>&1 \
    && uv pip install -q --python /root/venv-conv/bin/python "transformers==4.57.6" torch numpy sentencepiece protobuf gguf huggingface_hub || hold "conv venv"; }
  CV=/root/venv-conv/bin/python
  $CV - <<'P'
import json; p="/root/hfmodel/tokenizer_config.json"; d=json.load(open(p)); v=d.get("extra_special_tokens")
if isinstance(v,list): d["extra_special_tokens"]={} if not v else {str(i):x for i,x in enumerate(v)}; json.dump(d,open(p,"w"),ensure_ascii=False,indent=2); print("patched extra_special_tokens list->dict")
P
  ( cd /root/llama.cpp && cmake --build build --config Release -j "$THREADS" --target llama-quantize >> /root/build.log 2>&1 ) || hold "llama-quantize build"
  $CV /root/llama.cpp/convert_hf_to_gguf.py /root/hfmodel --no-mtp --outfile /root/gguf/model-f16.gguf --outtype f16 2>&1 | grep -viE "writing:|byte/s" | tail -2
  [ -s /root/gguf/model-f16.gguf ] || hold "convert produced no file"
  $CV - <<'P' || hold "GGUF block_count/tensor mismatch (is --no-mtp still honoured?)"
from gguf import GGUFReader; import re
r=GGUFReader("/root/gguf/model-f16.gguf")
bc=next((f.contents() for f in r.fields.values() if f.name.endswith("block_count")),None)
ns={int(m.group(1)) for t in r.tensors if (m:=re.match(r"blk\.(\d+)\.",t.name))}
print(f"block_count={bc} blk_tensors={len(ns)}"); assert bc==len(ns)==24,(bc,len(ns))
P
  /root/llama.cpp/build/bin/llama-quantize /root/gguf/model-f16.gguf /root/gguf/model-Q4_K_M.gguf Q4_K_M "$THREADS" >/dev/null 2>&1 || hold quantize
  rm -f /root/gguf/model-f16.gguf
  $CV - <<P || echo "WARN: GGUF upload failed (eval continues; convert will rerun next time)"
import os
from huggingface_hub import HfApi
HfApi(token=os.environ["HF_TOKEN"]).upload_file(path_or_fileobj="/root/gguf/model-Q4_K_M.gguf",path_in_repo="$GGUF_PATH",repo_id="$REPO",commit_message="Q4_K_M GGUF (--no-mtp), built by eval_driver")
print("GGUF uploaded to $REPO/$GGUF_PATH")
P
fi
G=$(find /root/gguf -name "*.gguf" | head -1); [ -s "$G" ] || hold "GGUF missing after pull/convert"
echo ">> serving $G on CPU"
/root/llama.cpp/build/bin/llama-server -m "$G" --port 8080 -c 4096 -t "$THREADS" -np 2 --jinja >/root/srv.log 2>&1 &
for i in $(seq 1 120); do curl -s localhost:8080/health 2>/dev/null | grep -q ok && break; sleep 2; done
curl -s localhost:8080/health | grep -q ok || { tail -15 /root/srv.log; hold "server never healthy"; }
touch /root/SERVING

cat > /root/run_probes.py <<'P'
import json, requests, re, sys
LABEL=sys.argv[1]
SP=json.load(open("/root/system-prompts.json"))
LANG={"tl":"tagalog","bis":"cebuano","bisaya":"cebuano","cebuano":"cebuano","en":"english","english":"english","tagalog":"tagalog"}
CEB=re.compile(r"\b(mao|nga|kaayo|naghimo|gikan|usa ka|ilang|atong|og|dili|kini|kana|pinaagi|tungod|unsa|maayong|nindot)\b")
def ask(system,user,max_tokens=400):
    r=requests.post("http://localhost:8080/v1/chat/completions",timeout=300,json={
        "messages":[{"role":"system","content":system},{"role":"user","content":user}],
        "max_tokens":max_tokens,"temperature":0.0,"chat_template_kwargs":{"enable_thinking":False}})
    r.raise_for_status(); return r.json()["choices"][0]["message"].get("content") or ""
probe=ask(SP["tagalog"],"Ano ang tubig?",60); assert probe.strip(), "EMPTY on self-check: think-block is open"
print("[selfcheck]",probe[:70],flush=True)
out={"label":LABEL,"routing":[],"capability":[],"gate":[]}
for p in json.load(open("/root/routing.json")):
    a=ask(SP[p["lang"]],p["prompt"]); ceb=bool(CEB.search(a[:140]))
    out["routing"].append({**p,"answer":a,"reply_is_ceb":ceb})
    print(f"[route] {'CEB' if ceb else 'TL '} {p['id']:22} -> {a[:80]!r}",flush=True)
r=out["routing"]; ceb_exp=[x for x in r if x["expect"]=="ceb"]
print(f"[route] SCORE: {sum(x['reply_is_ceb'] for x in ceb_exp)}/{len(ceb_exp)} Cebuano-mode prompts answered in Cebuano",flush=True)
probes=json.load(open("/root/probes.json")); probes=probes if isinstance(probes,list) else probes.get("probes",probes)
for i,p in enumerate(probes):
    if p.get("tier")=="multi-turn" or "prompt" not in p: continue
    try: a=ask(SP[LANG.get(p.get("lang","tl"),"tagalog")],p["prompt"])
    except Exception as e: a=f"<ERR {e}>"
    out["capability"].append({"id":p["id"],"tier":p.get("tier"),"lang":p.get("lang"),"prompt":p["prompt"],"answer":a})
    if i%20==0: print(f"[cap] {i}/{len(probes)}",flush=True)
cases=json.load(open("/root/cases.json")); cases=cases if isinstance(cases,list) else cases.get("cases",cases)
for c in cases:
    q=c.get("question")
    if not q: continue
    try: a=ask(SP[LANG.get(c.get("lang","tagalog"),"tagalog")],q)
    except Exception as e: a=f"<ERR {e}>"
    out["gate"].append({**c,"answer":a})
empties=sum(1 for k in ("routing","capability","gate") for x in out[k] if not (x.get("answer") or "").strip())
assert empties==0, f"{empties} EMPTY answers"
json.dump(out,open(f"/root/{LABEL}-eval-answers.json","w"),ensure_ascii=False,indent=1)
print("DONE",{k:len(out[k]) for k in ("routing","capability","gate")},flush=True)
P
hb 0 183 eval "eval $LABEL: routing + capability + gate probes"
$PY /root/run_probes.py "$LABEL" || hold "probe run failed"
$PY - <<P || hold "upload failed (answers still on pod)"
import os
from huggingface_hub import HfApi
api=HfApi(token=os.environ["HF_TOKEN"])
api.upload_file(path_or_fileobj="/root/$LABEL-eval-answers.json",path_in_repo="eval/$LABEL-eval-answers.json",repo_id="$REPO",commit_message="$LABEL eval answers (routing+capability+gate), Q4_K_M CPU, enable_thinking=false")
print("UPLOADED")
P
SCORE=$(grep -a "\[route\] SCORE" $LOG | tail -1 | cut -c9-)
hb 0 0 done "EVAL $LABEL COMPLETE — $SCORE — answers on HF"
touch /root/DEADMAN_CANCEL; sleep 15
curl -s -m 30 -X DELETE -H "Authorization: Bearer $RUNPOD_API_KEY" "https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID"
