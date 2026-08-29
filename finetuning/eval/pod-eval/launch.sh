#!/usr/bin/env bash
# Launch a pod-side eval of a merged GGUF on HF. Provisions the cheapest 24GB+ single GPU in any
# datacenter, stages the kit, and starts eval_driver.sh detached. The driver reports to
# hiraia.b11.dev/admin, uploads answers to the same HF repo under eval/, and self-terminates.
#
#   finetuning/eval/pod-eval/launch.sh <hf-repo> <gguf-path-in-repo> <label>
#   e.g. launch.sh Cryptopop/hiraia-sft-flagship-2b-v2 gguf/hiraia-sft-2b-Q4_K_M.gguf sft-v2
#
# Needs: .env.local (RUNPOD_API_KEY, HUGGINGFACE_API_KEY), ssh to the VPS for the HB token,
# ~/.ssh/id_ed25519 registered with RunPod. Guard ceiling `hiraia-eval` (4h) is already on the VPS.
set -euo pipefail
cd "$(dirname "$0")/../../.."
set -a; . ./.env.local; set +a
REPO="${1:?hf repo}"; GGUF="${2:?gguf path in repo}"; LABEL="${3:?label}"
HERE=finetuning/eval/pod-eval
HB=$(ssh -o ConnectTimeout=20 root@45.76.180.229 'python3 -c "import json;print(json.load(open(\"/opt/hiraia-monitor/config.json\"))[\"hb_token\"])"')
# freshest probe sets from the repo
cp finetuning/eval/capability/probes.json finetuning/eval/harness/cases.json "$HERE/kit/"
POD=$(python3 - <<'PY'
import json, urllib.request, os, sys
KEY=os.environ["RUNPOD_API_KEY"]
def gql(q):
    r=urllib.request.Request("https://api.runpod.io/graphql", data=json.dumps({"query":q}).encode(),
        headers={"Content-Type":"application/json","User-Agent":"hiraia/1.0","Authorization":f"Bearer {KEY}"})
    try: return json.load(urllib.request.urlopen(r,timeout=60))
    except Exception: return None
IMG="runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04"
dcs=[d["id"] for d in gql("query { dataCenters { id } }")["data"]["dataCenters"]]
hits=[]
for dc in dcs:
    d=gql('query { gpuTypes { id displayName memoryInGb lowestPrice(input:{gpuCount:1, dataCenterId:"%s"}){ stockStatus uninterruptablePrice } } }'%dc)
    if not d: continue
    for g in d["data"]["gpuTypes"]:
        lp=g.get("lowestPrice") or {}
        if lp.get("stockStatus") and str(lp["stockStatus"]).lower() not in ("none","null") and lp.get("uninterruptablePrice") and (g.get("memoryInGb") or 0)>=24:
            hits.append((float(lp["uninterruptablePrice"]),dc,g["id"],g["displayName"]))
for price,dc,gid,dn in sorted(hits)[:15]:
    q=('mutation { podFindAndDeployOnDemand(input: { cloudType: SECURE, gpuCount: 1, '
       f'gpuTypeId: "{gid}", dataCenterId: "{dc}", volumeMountPath: "/workspace", containerDiskInGb: 60, '
       f'minVcpuCount: 8, minMemoryInGb: 32, supportPublicIp: true, imageName: "{IMG}", ports: "22/tcp", startSsh: true, name: "hiraia-eval" }}) {{ id }} }}')
    d=gql(q)
    if d and not d.get("errors") and (d["data"]["podFindAndDeployOnDemand"] or {}).get("id"):
        print(d["data"]["podFindAndDeployOnDemand"]["id"]); sys.stderr.write(f"pod: ${price}/hr {dn} {dc}\n"); sys.exit(0)
sys.stderr.write("NO CAPACITY\n"); sys.exit(1)
PY
)
# fail-safe: if anything below fails before the driver is running, do not leave a driverless pod billing
LAUNCHED=0
cleanup(){ if [ "$LAUNCHED" != 1 ]; then echo "launcher failed before the driver started — terminating $POD" >&2
  curl -s -m 30 -X DELETE -H "Authorization: Bearer $RUNPOD_API_KEY" -H "User-Agent: hiraia/1.0" "https://rest.runpod.io/v1/pods/$POD" >/dev/null; fi; }
trap cleanup EXIT
echo "created $POD; waiting for ssh"
for i in $(seq 1 40); do
  R=$(curl -s --max-time 30 -H "Authorization: Bearer $RUNPOD_API_KEY" -H "User-Agent: hiraia/1.0" "https://rest.runpod.io/v1/pods/$POD" | python3 -c "
import json,sys
p=json.loads(sys.stdin.read(),strict=False); pm=p.get('portMappings') or {}
print(p.get('desiredStatus'), p.get('publicIp') or '-', pm.get('22') or '-')" 2>/dev/null)
  case "$R" in RUNNING\ [0-9]*\ [0-9]*) IP=$(echo $R|cut -d' ' -f2); PORT=$(echo $R|cut -d' ' -f3); break;; esac
  sleep 15
done
echo "$POD $IP $PORT x x" > /tmp/eval-pod.txt
SSH="ssh -o StrictHostKeyChecking=no -o ConnectTimeout=40 -i ${HOME:-/root}/.ssh/id_ed25519 -p $PORT root@$IP"
scp -o StrictHostKeyChecking=no -o ConnectTimeout=30 -P "$PORT" "$HERE"/kit/*.json "$HERE/eval_driver.sh" "root@$IP:/root/" >/dev/null
printf '%s' "$HUGGINGFACE_API_KEY" > /tmp/.t && scp -o StrictHostKeyChecking=no -P "$PORT" /tmp/.t "root@$IP:/root/.hftok" >/dev/null; rm -f /tmp/.t
# env.sh is written LOCALLY and scp'd: a heredoc inside an ssh "..." string goes through two
# rounds of unescaping and HF_TOKEN lands on the pod as the literal text $(cat /root/.hftok).
ENV=$(mktemp)
cat > "$ENV" <<E
export RUNPOD_POD_ID='$POD'
export RUNPOD_API_KEY='$RUNPOD_API_KEY'
export HB_TOKEN='$HB'
export HF_TOKEN="\$(cat /root/.hftok)"
E
DEAD=$(mktemp)
cat > "$DEAD" <<E
#!/usr/bin/env bash
sleep 7200; [ -e /root/DEADMAN_CANCEL ] && exit 0
curl -s -m 30 -X DELETE -H 'Authorization: Bearer $RUNPOD_API_KEY' https://rest.runpod.io/v1/pods/$POD
E
scp -o StrictHostKeyChecking=no -P "$PORT" "$ENV" "root@$IP:/root/env.sh" >/dev/null
scp -o StrictHostKeyChecking=no -P "$PORT" "$DEAD" "root@$IP:/root/deadman.sh" >/dev/null
rm -f "$ENV" "$DEAD"
$SSH 'chmod 600 /root/.hftok /root/env.sh; chmod +x /root/eval_driver.sh /root/deadman.sh
. /root/env.sh; [ -n "$HF_TOKEN" ] && [ "${HF_TOKEN#\$}" = "$HF_TOKEN" ] || { echo "env.sh: HF_TOKEN did not resolve"; exit 1; }
nohup /root/deadman.sh >/dev/null 2>&1 </dev/null &
nohup /root/eval_driver.sh "'"$REPO"'" "'"$GGUF"'" "'"$LABEL"'" >/dev/null 2>&1 </dev/null &
echo LAUNCHED' && LAUNCHED=1

echo "eval '$LABEL' running on $POD — watch hiraia.b11.dev/admin; answers land at $REPO/eval/$LABEL-eval-answers.json"
