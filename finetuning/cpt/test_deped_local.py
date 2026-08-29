#!/usr/bin/env python3
"""Local smoke test for crawl_deped.py: bounded BFS (12 pages), verify link + ID extraction."""
import sys
sys.path.insert(0, "/Users/luis/Code/hiraia/finetuning/cpt")
import crawl_deped as cd

cd.MAX_PAGES = 12
cd.PAGE_DELAY = 0.1
page_ids = cd.crawl_pages()
total_ids = {i for ids in page_ids.values() for i in ids}
print(f"PAGES WITH FILES: {len(page_ids)}/12 crawled; unique drive ids: {len(total_ids)}")
for p, ids in list(page_ids.items())[:5]:
    print(f"  {p}: {len(ids)} ids")
