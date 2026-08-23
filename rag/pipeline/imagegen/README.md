# Image batch — pending download

7,742 illustrations were generated for the DepEd cards that had no picture in the existing
library. All three batches COMPLETED and are paid for; only the output files still need
collecting.

| batch | images | status |
|---|---|---|
| `batch_6a8a6f7f86cc819088117200f8224bed` | 3,464 | 2.79 GB of 5.96 GB already downloaded — RESUMES |
| `batch_6a8a797406e4819098c5db863297f437` | 3,450 | not started |
| `batch_6a8a81ff16608190a16f32f67754f37e` | 724 | not started |

1,630 images are already extracted and converted (`webp/`).

## Why this needs a browser

`/v1/files/{id}/content` cannot serve these. Measured here: the request takes ~90 s to begin,
then dies at ~19 MB with `HTTP/2 stream not closed cleanly: INTERNAL_ERROR`. This is a widely
reported limit — outputs above roughly 200-300 MB fail mid-transfer regardless of client
library, and there is no Range support to resume around it. The signed blob URL from
platform.openai.com is the only path that works at this size.

## When you're at a desktop

For each batch, open platform.openai.com/batches, copy the download URL, then:

    rag/pipeline/imagegen/fetch-batch.sh <batch_id> '<signed-url>'

It resumes from whatever is already on disk (so batch 1 pulls only the remaining ~3.2 GB),
extracts PNGs while tolerating a truncated final line, and converts to 512x512 WebP.
The URLs expire in a few hours - paste each one promptly.

## Next time: size batches by OUTPUT, not request count

These were chunked at 3,500 REQUESTS, which at ~1.7 MB per PNG produced 6 GB output files -
30x over the threshold that downloads reliably. About 120 images per batch lands near 200 MB
and can be pulled straight through the API with no browser involved. That is the fix for any
future run; it does not help these three, which already exist.
