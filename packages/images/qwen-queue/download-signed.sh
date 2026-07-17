#!/usr/bin/env bash
# Download a batch output file from a browser signed-blob URL (resumable) and extract its PNGs.
# The API /files/{id}/content endpoint 504s on large batch outputs; the platform Storage page's
# Download button gives a working signed URL — paste it here.
#
#   bash packages/images/qwen-queue/download-signed.sh 'https://fileservice...blob.core.windows.net/...'
#
# Resumable: if the connection drops, re-run with a FRESH signed URL (signed URLs expire ~5min,
# but curl -C - continues from the partial file). Saves PNGs into out-final/, logs to manifest-batch.
set -euo pipefail
cd "$(dirname "$0")/../../.."
URL="${1:?usage: download-signed.sh <signed-url>}"
TMP="/tmp/batch-signed-$(date +%s).jsonl"
OUT="packages/images/qwen-queue/out-final"

echo "downloading (resumable) → $TMP"
curl -C - --retry 5 -o "$TMP" "$URL"
echo "downloaded $(du -h "$TMP" | cut -f1); parsing..."
python3 - "$TMP" <<'PY'
import json, base64, os, sys
OUT='packages/images/qwen-queue/out-final'
man=open('packages/images/qwen-queue/manifest-batch.jsonl','a')
dfh=open('packages/images/qwen-queue/moderation-declined.txt','a')
saved=decl=out_tok=0
with open(sys.argv[1]) as f:
    for line in f:
        line=line.strip()
        if not line: continue
        o=json.loads(line); cid=o['custom_id']; resp=o.get('response') or {}
        if resp.get('status_code')==200 and resp.get('body',{}).get('data'):
            u=resp['body'].get('usage',{})
            raw=base64.b64decode(resp['body']['data'][0]['b64_json'])
            open(os.path.join(OUT,f'{cid}.png'),'wb').write(raw)
            ot=u.get('output_tokens',0); ti=u.get('input_tokens_details',{}).get('text_tokens',u.get('input_tokens',0))
            out_tok+=ot; saved+=1
            man.write(json.dumps({'id':cid,'provider':'openai-batch','quality':'low','in_text_tokens':ti,'out_tokens':ot,'cost_usd':round((ti*5e-6+ot*30e-6)*0.5,6),'bytes':len(raw),'status':'ok'},ensure_ascii=False)+'\n')
        else:
            decl+=1; dfh.write(cid+'\n')
man.flush()
print(f'  saved {saved} PNGs | {decl} declined (→ moderation-declined.txt) | batch cost ${round(out_tok*30e-6*0.5,2)}')
print('  out-final total:', len([x for x in os.listdir(OUT) if x.endswith(".png")]))
PY
rm -f "$TMP"
echo "done (temp file removed)"
