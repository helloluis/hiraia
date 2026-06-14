/**
 * "Hiraia Performance" landing section — the **hiraiabench** comparison.
 *
 * Shows how Hiraia's fine-tuning lifts a small on-device model past the untrained
 * open-weights bases (Sailor2-3B, Qwen3-1.7B) and toward a cloud frontier model
 * (Claude Opus 4.7) on the dimensions that matter for a Filipino science tutor.
 * Scores are 0–5 (LLM-judged); each Hiraia release should beat the last.
 *
 * Scores are placeholders ("—") for now — wire real numbers from the capability
 * benchmark when we publish them.
 */

const METRICS = ['Tagalog Fluency', 'English Fluency', 'Science Accuracy', 'Pedagogy'] as const;

type Row = {
  model: string;
  note: string;
  highlight?: boolean;
  scores: (number | null)[]; // null → "—" placeholder
};

const ROWS: Row[] = [
  { model: 'Hiraia', note: 'our on-device fine-tune', highlight: true, scores: [null, null, null, null] },
  { model: 'Claude Opus 4.7', note: 'cloud frontier (reference)', scores: [null, null, null, null] },
  { model: 'Sailor2-3B', note: 'untrained base', scores: [null, null, null, null] },
  { model: 'Qwen3-1.7B', note: 'untrained base', scores: [null, null, null, null] },
];

const fmt = (s: number | null) => (s == null ? '—' : s.toFixed(1));

export function HiraiaBench() {
  return (
    <div className="w-full bg-[#fcfdfd] py-16 sm:py-24 px-6 md:px-12 lg:px-24 border-b border-gray-100">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-3xl sm:text-4xl md:text-5xl font-display text-[#0c343d] tracking-tight leading-tight mb-2">
          Hiraia performance
        </h2>
        <p className="text-base sm:text-lg text-[#0c343d]/80 leading-relaxed max-w-2xl mb-8 md:mb-10">
          <span className="font-semibold">hiraiabench</span> measures the impact of our fine-tuning:
          a tiny on-device model that beats the untrained open-weights bases and approaches a cloud
          frontier model — on the things that matter for a Filipino science tutor. Scored 0–5;
          higher is better. Each Hiraia release aims to beat the last.
        </p>

        <div className="overflow-x-auto rounded-2xl border border-gray-200 shadow-sm">
          <table className="w-full min-w-[640px] text-left border-collapse">
            <thead>
              <tr className="bg-[#0c343d] text-white">
                <th className="px-4 sm:px-6 py-4 font-display text-base sm:text-lg sticky left-0 bg-[#0c343d] z-10">
                  Model
                </th>
                {METRICS.map((m) => (
                  <th key={m} className="px-3 sm:px-5 py-4 font-display text-sm sm:text-base text-center whitespace-nowrap">
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr
                  key={r.model}
                  className={`border-t border-gray-200 ${
                    r.highlight ? 'bg-[#f3a228]/15' : 'bg-white'
                  }`}
                >
                  <th
                    scope="row"
                    className={`px-4 sm:px-6 py-4 sticky left-0 z-10 ${
                      r.highlight ? 'bg-[#fdf3e1]' : 'bg-white'
                    }`}
                  >
                    <div className={`font-display text-base sm:text-lg ${r.highlight ? 'text-[#0c343d]' : 'text-gray-800'}`}>
                      {r.model}
                      {r.highlight && (
                        <span className="ml-2 align-middle text-[10px] uppercase tracking-wider font-sans font-bold text-[#0c343d] bg-[#f3a228] rounded-full px-2 py-0.5">
                          ours
                        </span>
                      )}
                    </div>
                    <div className="text-xs sm:text-sm text-gray-500 font-sans">{r.note}</div>
                  </th>
                  {r.scores.map((s, i) => (
                    <td
                      key={i}
                      className={`px-3 sm:px-5 py-4 text-center font-display text-lg sm:text-xl ${
                        r.highlight ? 'text-[#0c343d] font-bold' : 'text-gray-700'
                      }`}
                    >
                      {fmt(s)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs sm:text-sm text-gray-500 mt-4 max-w-2xl">
          Scores coming soon — benchmarked with an LLM judge across a curated probe set covering each
          dimension. Sailor2-3B and Qwen3-1.7B are run untrained; Hiraia is the same class of model,
          fine-tuned.
        </p>
      </div>
    </div>
  );
}
