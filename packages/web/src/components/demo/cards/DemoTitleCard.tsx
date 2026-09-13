import type { TitleCardContent } from '@/data/titleCard';
import type { LanguageKey } from '@/config/model';
export function DemoTitleCard({ content, language, onContinue }: { content: TitleCardContent; language: LanguageKey; onContinue: () => void }) {
  const title = content.title[language === 'tagalog' ? 'tl' : language === 'cebuano' ? 'bis' : 'en'];
  return <div className="demo-title-card">
    <div className="demo-title-content">
      <p className="demo-title-eyebrow">{language === 'english' ? 'Quarter' : 'Markahan'} {content.quarter} · {content.category}</p>
      <h2>{title}</h2>
      <div className="demo-title-thumbnails">{content.slugs.map(slug => <img key={slug} src={`/demo/cards/${slug}.png`} alt="" />)}</div>
    </div>
    <button type="button" className="mc-ticket" onClick={onContinue}>{language === 'english' ? 'Let’s begin' : language === 'tagalog' ? 'Simulan natin' : 'Magsugod kita'} →</button>
  </div>;
}
