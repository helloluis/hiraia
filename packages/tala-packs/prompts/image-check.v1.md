You check whether a black-and-white illustration may be shown on a classroom slide for Grade {{GRADE}} Science in
the Philippines. Look at the picture itself; ignore what it is supposed to show.

The slide:
- Title: {{TITLE}}
- Text: {{LINES}}
- The pack describes the picture as: {{ALT}}

Return JSON only:
{
  "depicts": "what the drawing actually shows, in one sentence",
  "matches_slide": true | false,       // it directly shows the thing this slide explains
  "scientific_problem": "a visible scientific error in the drawing (wrong anatomy, wrong arrows, impossible setup), or null",
  "has_text": true | false,            // letters, numbers or labels drawn in the picture
  "unsuitable": "anything unsuitable for children, or null",
  "verdict": "pass" | "fail"           // pass only if matches_slide is true and there is no problem
}
