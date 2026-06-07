// LaBSE-on-QVAC sanity check. LaBSE: BERT-native, CLS pooling, NO e5 prefix.
//   node_modules/bare-runtime-darwin-arm64/bin/bare rag/embeddings-spike/qvac-labse-test.cjs
const GGMLBert = require('@qvac/embed-llamacpp')
const path = require('bare-path')
const fs = require('bare-fs')
const MODEL = path.join(__dirname, 'models', 'labse-fp16.gguf')
const args = {
  files: { model: [MODEL] },
  config: { device: 'cpu', pooling: 'cls', embd_normalize: '2', ctx_size: '192' },
  logger: { info() {}, warn() {}, error: console.error, debug() {} },
  opts: { stats: true },
}
function vecOf(out) {
  let o = out
  while (Array.isArray(o) && o.length === 1 && (Array.isArray(o[0]) || ArrayBuffer.isView(o[0]))) o = o[0]
  if (ArrayBuffer.isView(o)) return Array.from(o)
  if (Array.isArray(o)) return o.map(Number)
  if (o && o.embedding) return Array.from(o.embedding)
  if (o && o.data) return Array.from(o.data)
  return o
}
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0)
async function embed(model, t) { const r = await model.run(t); return vecOf(await r.await()) }
async function main() {
  const model = new GGMLBert(args)
  const t0 = Date.now(); await model.load(); console.log(`loaded in ${Date.now() - t0}ms`)
  const texts = [
    'ano ang ginagawa ng utak',                                  // query (LaBSE: no prefix)
    'the brain. Ang utak ang sentro ng katawan na kumokontrol sa pag-iisip at galaw.',
    'the heart. Ang puso ang nagpapadaloy ng dugo sa buong katawan.',
  ]
  const v = []
  for (const t of texts) { const e = await embed(model, t); v.push(e); console.log(`dim=${e.length} |v|=${Math.sqrt(dot(e, e)).toFixed(4)}  "${t.slice(0, 38)}"`) }
  const qb = dot(v[0], v[1]), qh = dot(v[0], v[2])
  console.log(`\ncos(utak, brain)=${qb.toFixed(4)}  cos(utak, heart)=${qh.toFixed(4)}  ${qb > qh ? '✅ brain>heart' : '❌ heart>=brain'}`)
  fs.writeFileSync(path.join(__dirname, 'qvac_labse_utak.json'), JSON.stringify(v[0]))
  await model.unload(); console.log('wrote qvac_labse_utak.json')
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1) })
