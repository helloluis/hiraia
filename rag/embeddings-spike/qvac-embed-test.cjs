// Sanity check: can @qvac/embed-llamacpp (the on-device embedder) load an e5
// GGUF and produce usable embeddings? Run with the Bare runtime:
//   node_modules/.bin/bare rag/embeddings-spike/qvac-embed-test.js
const GGMLBert = require('@qvac/embed-llamacpp')
const path = require('bare-path')
const fs = require('bare-fs')

const MODEL = path.join(__dirname, 'models', 'e5-small-fp32.gguf')
// e5 recipe: mean pooling + L2 (euclidean) normalize. CPU avoids GPU kernel
// cold-start (fine for one short query at a time).
const args = {
  files: { model: [MODEL] },
  config: { device: 'cpu', pooling: 'mean', embd_normalize: '2', ctx_size: '192' },
  logger: { info() {}, warn: console.warn, error: console.error, debug() {} },
  opts: { stats: true },
}

function vecOf(out) {
  // unwrap whatever shape run() returns into a flat number[]
  let o = out
  while (Array.isArray(o) && o.length === 1 && (Array.isArray(o[0]) || ArrayBuffer.isView(o[0]))) o = o[0]
  if (ArrayBuffer.isView(o)) return Array.from(o)
  if (Array.isArray(o)) return o.map(Number)
  if (o && o.embedding) return Array.from(o.embedding)
  if (o && o.data) return Array.from(o.data)
  return o
}
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0)
const norm = (a) => Math.sqrt(dot(a, a))

async function embed(model, text) {
  const resp = await model.run(text)
  const out = await resp.await()
  return vecOf(out)
}

async function main() {
  console.log('model exists:', fs.existsSync(MODEL))
  const model = new GGMLBert(args)
  const t0 = Date.now()
  await model.load()
  console.log(`loaded in ${Date.now() - t0}ms`)

  const tests = [
    'query: ano ang ginagawa ng utak',
    'passage: the brain. Ang utak ang sentro ng katawan na kumokontrol sa pag-iisip at galaw.',
    'passage: the heart. Ang puso ang nagpapadaloy ng dugo sa buong katawan.',
  ]
  const vecs = []
  for (const t of tests) {
    const tq = Date.now()
    const v = await embed(model, t)
    vecs.push(v)
    console.log(`\n"${t.slice(0, 45)}..."  dim=${v.length}  |v|=${norm(v).toFixed(4)}  (${Date.now() - tq}ms)`)
    console.log('  first 6:', v.slice(0, 6).map((x) => x.toFixed(4)).join(', '))
  }
  // sanity: utak-query should be closer to the brain passage than the heart passage
  const cosQB = dot(vecs[0], vecs[1])
  const cosQH = dot(vecs[0], vecs[2])
  console.log(`\ncos(utak-query, brain-passage) = ${cosQB.toFixed(4)}`)
  console.log(`cos(utak-query, heart-passage) = ${cosQH.toFixed(4)}`)
  console.log(cosQB > cosQH ? '✅ brain > heart — semantics work' : '❌ heart >= brain — something is off')

  // dump the query vector for a parity check vs transformers
  fs.writeFileSync(path.join(__dirname, 'qvac_utak_vec.json'), JSON.stringify(vecs[0]))
  await model.unload()
  console.log('\nunloaded. wrote qvac_utak_vec.json')
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1) })
