#!/usr/bin/env python3
"""Harvest all Cebuano BloomLibrary books: enumerate via Parse, pull each
book's bloomdigital HTML from S3, extract the Cebuano (lang="ceb") text.
CC-licensed content; license recorded per file."""
import json, os, re, time, urllib.request, urllib.parse, html as htmlmod

PARSE="https://bloom-parse-server-production.azurewebsites.net/parse"
APPID="R6qNTeumQXjJCMutAJYAwPtip1qBulkFyLefkCE5"
HDR={"X-Parse-Application-Id":APPID}
ROOT="/Users/luis/Code/hiraia/finetuning/datasets/bisaya"
OUT=os.path.join(ROOT,"sources","bloom"); os.makedirs(OUT,exist_ok=True)
RAW=os.path.join(ROOT,".raw")
DATE="2026-05-31"
# all language objects whose isoCode is "ceb" (Cebuano / Bisaya / Sinugbuanong Binisaya),
# restricted to books Bloom has harvested (only those have readable bloomdigital content)
CEB_WHERE={"langPointers":{"$inQuery":{"where":{"isoCode":"ceb"},"className":"language"}},
           "harvestState":"Done"}

def get_json(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url,headers=HDR),timeout=45).read().decode())
def get_raw(url):
    return urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0"}),timeout=45).read().decode("utf-8","ignore")

def slugify(s):
    s=re.sub(r"[^a-z0-9]+","-",(s or "untitled").lower())
    return s.strip("-")[:60] or "untitled"

def clean(t):
    t=htmlmod.unescape(t); t=re.sub(r"\s+"," ",t).strip(); return t

def extract_ceb(html):
    # drop scripts/styles
    html=re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>"," ",html)
    # find elements carrying lang="ceb" (bloom-editable divs); capture inner text
    blocks=re.findall(r'(?is)<div[^>]*\blang=["\']ceb["\'][^>]*>(.*?)</div>', html)
    texts=[]
    seen=set()
    for b in blocks:
        txt=clean(re.sub(r"<[^>]+>"," ",b))
        if len(txt)>=2 and txt.lower() not in seen:
            seen.add(txt.lower()); texts.append(txt)
    if not texts:  # fallback: any bloom-editable
        blocks=re.findall(r'(?is)<div[^>]*class=["\'][^"\']*bloom-editable[^"\']*["\'][^>]*>(.*?)</div>',html)
        for b in blocks:
            txt=clean(re.sub(r"<[^>]+>"," ",b))
            if len(txt)>=2 and txt.lower() not in seen:
                seen.add(txt.lower()); texts.append(txt)
    return "\n\n".join(texts)

def s3_list(bucket, prefix):
    url=f"https://s3.amazonaws.com/{bucket}?list-type=2&prefix={urllib.parse.quote(prefix)}&max-keys=300"
    return re.findall(r"<Key>(.*?)</Key>", get_raw(url))

def fetch_book_html(base):
    # The book's HTML lives loose in the upload bucket as "<Title>/<Title>.htm".
    # List the folder to find the exact key, then fetch it (spaces -> %20).
    m=re.match(r"https://s3\.amazonaws\.com/([^/]+)/(.+)$", base)
    if not m: return None,None
    bucket=m.group(1); prefix=urllib.parse.unquote_plus(m.group(2))
    try:
        keys=s3_list(bucket, prefix)
    except Exception:
        return None,None
    htms=[k for k in keys if k.lower().endswith(".htm")]
    if not htms: return None,None
    folder=prefix.rstrip("/").split("/")[-1]
    htms.sort(key=lambda k: (folder not in k, len(k)))  # prefer the title-named htm
    for k in htms:
        try:
            body=get_raw("https://s3.amazonaws.com/"+bucket+"/"+urllib.parse.quote(k))
            if body: return body,k
        except Exception:
            continue
    return None,None

# enumerate (all ceb-iso books, paginated)
books=[]
for skip in range(0,1000,100):
    q={"where":json.dumps(CEB_WHERE),
       "limit":"100","skip":str(skip),
       "keys":"title,baseUrl,license,copyright,pageCount,readingLevel,summary"}
    res=get_json(f"{PARSE}/classes/books?{urllib.parse.urlencode(q)}").get("results",[])
    books+=res
    if len(res)<100: break
print(f"enumerated {len(books)} Cebuano books")

summary=[]; used=set()
for i,b in enumerate(books,1):
    title=b.get("title","untitled")
    base=b.get("baseUrl","")
    lic=b.get("license"); lic=lic.get("name") if isinstance(lic,dict) else lic
    if not base:
        print(f"  {i:3} SKIP no-baseUrl {title}"); continue
    html,won=fetch_book_html(base)
    if not html:
        print(f"  {i:3} FAIL fetch {title}"); continue
    text=extract_ceb(html)
    words=len(text.split())
    if words<10:
        print(f"  {i:3} SKIP thin({words}w) {title}"); continue
    slug="bloom-"+slugify(title)
    n=2
    while slug in used: slug=f"bloom-{slugify(title)}-{n}"; n+=1
    used.add(slug)
    notes=(f"BloomLibrary, reading level {b.get('readingLevel')}. License: {lic}. "
           f"Copyright: {b.get('copyright')}. Pages: {b.get('pageCount')}. "
           f"{clean(b.get('summary') or '')}")
    body=(f"# {title}\nSource: https://bloomlibrary.org/book/{b.get('objectId','')}\n"
          f"Retrieved: {DATE}\nLanguage: Bisaya/Cebuano\nGrade level: Bloom L{b.get('readingLevel')}\n\n"
          f"{text}\n\n## Notes\n{notes}\n")
    open(os.path.join(OUT,slug+".txt"),"w").write(body)
    summary.append({"slug":slug,"title":title,"words":words,"license":lic,"level":b.get("readingLevel")})
    print(f"  {i:3} OK {words:4}w  {slug}")
    time.sleep(0.15)

json.dump(summary,open(os.path.join(RAW,"bloom_summary.json"),"w"),indent=1,ensure_ascii=False)
print(f"\nDONE: {len(summary)} books harvested, {sum(s['words'] for s in summary):,} words")
