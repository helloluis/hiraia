# Curriculum-first feed

The default feed resumes the active profile’s saved topic for its selected grade.
For a grade without saved progress, the existing school-calendar inference estimates
progress through the year. Topics are spaced evenly within each curriculum quarter;
this is a starting estimate, not knowledge of a particular classroom’s pace. Outside
the school year it starts at the first topic. The curriculum sheet lets a student or
teacher choose a different topic.

Each normal next-card choice stays within the current topic without keyword-based
ranking or forks. Saved card coverage advances exhausted topics in outline order.
After the final topic, the feed begins a curriculum review pass. Search can show a
one-off result, then the curriculum continues. Randomize clears the restriction and
starts the existing keyword-associated feed for the session. Reopening the app resumes
the saved curriculum; grade changes restore that grade’s saved topic or estimate.

Topic keys are stored as cards.curriculum.<grade> in the existing profile-specific
SQLite settings, alongside existing seen-card records. No model or network is needed.
The existing curriculum card membership and minimum-three-cards topic filter apply.

The title bar groups the name and switch arrow in one accessible pill on the right.
The compact page count and quiz ticks sit inside the card footer; the outer footer
retains Settings, grade, and correct-answer count.

Validation: mobile TypeScript check, curriculum-default.test.mts, and the existing
card harness (keyword, search magnet, and curriculum assertions). Device visual
validation requires a newly built APK; the installed APK predates these changes.
