# Connected lessons and section recaps

New curriculum runs retain their larger eligible card pool while teaching authored
core objectives in order. Optional examples are selected in blocks of up to five
cards and displayed together by their existing topic group. A fresh seed varies
starting examples and independent example groups; it does not shuffle the core
objective order. Unseen facts are preferred and duplicate source facts remain
excluded. Existing valid saved runs keep their exact sequence and progress.

At a completed lesson or manually selected subcategory boundary, the feed finishes
any pending review quiz and displays a recap before entering the next lesson.
The recap lists existing localized text from the cards visited in that run. It
says “what we explored,” not that the student has mastered the material.

“Explore again” replans the same scope from the student's existing coverage,
favoring unseen examples when available. It preserves activity, quiz results and
achievements. Once the pool is exhausted, revisiting can include familiar cards.
Swiping sideways or pressing the next-section button continues; vertical gestures
scroll the recap. Explicit Calendar jumps, searches and Randomize remain available.

The recap and its next-lesson destination are saved per profile and grade when the
final card lands, so restarting at that boundary restores the recap. Neither recap
nor title pages record an additional fact-card view. No model inference or network
request is needed to prepare the recap. APK publication is a separate release step.

Validation: `lesson-recap.test.mts` exercises actual store boundary/navigation
functions, serialization, repeat scope and contiguous ordering. Existing lesson
variety, Calendar, curriculum, grade and review tests cover content eligibility,
objective quizzes, old saves and review behavior.
