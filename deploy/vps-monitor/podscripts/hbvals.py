import re, sys
p = sys.argv[1] if len(sys.argv) > 1 else "/workspace/fullrun/train.log"
try:
    t = open(p, "rb").read().decode("utf8", "replace").replace("\r", "\n")
except OSError:
    print("0 0 0 0"); raise SystemExit
def last(pat, default="0"):
    m = re.findall(pat, t); return m[-1] if m else default
st = re.findall(r"['\"]global_step/max_steps['\"]:\s*['\"](\d+)/(\d+)['\"]", t)
step, total = st[-1] if st else ("0", "0")
loss = last(r"['\"]loss['\"]:\s*['\"]([0-9.eE+-]+)['\"]")
sit  = last(r"['\"]train_speed\(s/it\)['\"]:\s*['\"]([0-9.]+)['\"]")
print(f"{step} {loss} {sit} {total}")
