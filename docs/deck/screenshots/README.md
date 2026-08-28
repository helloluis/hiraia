Screenshots for the deck, captured from the **card-ui** build (the current UI) running on an
Android 34 emulator (720×1600, 320 dpi) — see the build recipe in the deck memory note:

  01-engraving-card.png  fact card with an engraving illustration (title slide)
  02-feed-card.png       fact card with a clip-art illustration (slide 3)
  04-quiz-card.png       interject quiz card (slide 3)

Captured with `adb exec-out screencap -p`, cropped to drop the navigation pill, rounded and
outlined in ink by the snippet in build-deck.py's history. To refresh: boot the emulator
(`emulator -avd hiraia-redmi`), install the APK (the release APK declares libOpenCL as required,
which the emulator lacks — patch the manifest to `android:required="false"` with apktool, re-sign,
then install), walk the feed, and re-crop into this folder.
