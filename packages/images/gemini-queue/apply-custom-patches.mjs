import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(HERE, 'prompts');

const CUSTOM_PATCHES = {
  "pufferfish-deflated": "The pufferfish must be completely deflated, with a smooth, oblong, teardrop-shaped body. Its spines must lie completely flat, smooth, and sleek against its skin, not pointing outwards or looking spiky.",
  "remora-suckerfish": "The suction pad on top of the remora's head must be depicted as a flat, oval, ridged sucking disk with parallel transverse plates (resembling the sole of a shoe), resting flat on top of its head, not a vertical fin or crest.",
  "sea-krait-banded": "The tail of the sea snake must end in a simple, smooth, paddle-like flat tail for swimming, not a fish fin with fin rays.",
  "sea-snake-walo-walo": "The tail of the sea snake must end in a simple, smooth, paddle-like flat tail for swimming, not a fish fin with fin rays. The snake must have a single normal head.",
  "shrew-tree-shrew": "The tree shrew must have exactly four limbs (two front legs, two hind legs) gripping the branch. Do not draw any extra legs.",
  "octopus-arms-curled": "The octopus must be drawn with exactly eight arms. Do not draw nine or ten arms.",
  "octopus-jet-swim": "The octopus must be drawn with exactly eight arms. Do not draw nine or ten arms.",
  "air-pressure-egg-bottle": "Show exactly one hard-boiled egg. The egg is shown half-squeezed through the narrow neck of a single clear glass bottle, with the lower half of the egg inside the bottle and the upper half on the rim, illustrating air pressure drawing it in.",
  "battery-flashlight-circuit": "Show a cutaway diagram of a simple flashlight circuit: two cylindrical batteries placed end-to-end inside the flashlight body, with a clear metal strip or wire connecting the negative terminal of the bottom battery to the switch, and the positive terminal of the top battery touching the metal base of the light bulb, creating a closed loop circuit.",
  "battery": "Draw a single standard cylindrical AA battery with a distinct positive terminal nub on one end and a flat negative terminal on the other, showing its simple external shape.",
  "biogas-digester-farm": "The gas line tube must connect directly to a single metal burner on top of the stove, and the flame must burn cleanly on top of the burner, not inside the cabinet/body of the stove.",
  "build-simple-circuit-hands-on": "Draw a complete closed circuit: two hands are holding insulated copper wires, connecting the positive and negative terminals of a cylindrical battery to the metal collar and contact point of a small light bulb, making the bulb glow. The wires must touch the electrical contacts on the bulb base, not the glass.",
  "camera-pinhole-image": "Draw a simple ray diagram of a pinhole camera: a rectangular box with a tiny pinhole on the front side. Straight light rays cross at the pinhole, projecting an upside-down (inverted) image of a simple tree onto the back inner wall of the box.",
  "sari-sari-store-beam-scale": "Draw a hanging spring scale (beam scale) with a clear circular dial and a pointer, and a hook hanging from the bottom holding a bag of goods being weighed.",
  "spring-rubberband": "Draw a vertical metal coil spring and a thick rubber band hanging side-by-side, both being stretched downwards by a simple hanging weight, illustrating elasticity.",
  "windmill-water-pump-farm": "Draw a classic farm windmill with a vertical pump rod going straight down from the windmill head into a well pipe on the ground, pumping water into a simple round trough. Do not show any oil-pumpjack balance beams or hanging buckets.",
  "bathing-cleanliness-scene": "A person is holding a plastic water scoop (tabo) in their hand to pour water over their shoulders. Do not mount the tabo to the wall or show water spraying out of its bottom.",
  "fisherman-casting-net-scene": "A fisherman standing on a small outrigger boat (banca) is throwing a circular, mesh cast net by hand into the sea. The net is unfurling in mid-air. Do not show any fishing rods, reels, or landing nets.",
  "fishing-banca-sea-scene": "A fisherman standing on a small outrigger boat (banca) is throwing a circular, mesh cast net by hand into the sea. The net is unfurling in mid-air. Do not show any fishing rods, reels, or landing nets.",
  "kalesa-horse-carriage-scene": "The horse-drawn kalesa carriage must have exactly two large wooden wheels (one on each side) and not four wheels.",
  "kids-playing-luksong-tinik-scene": "Two children sit on the ground facing each other with their hands and feet stacked to form a hurdle. Another child is jumping cleanly over their stacked hands, not stepping on their heads.",
  "kuliglig-hand-tractor-cart-scene": "The driver is standing or sitting on the rear trailer cart holding the long handles of the two-wheeled hand tractor (kuliglig) ahead of him. The trailer cart must have exactly two wheels aligned on a single axle.",
  "lechon-on-spit-scene": "The roasted pig on a wooden spit must have exactly four legs (two front legs, two rear legs) extending outwards.",
  "magtataho-vendor-pouring-scene": "The vendor has set the two large metal buckets on the ground. He is standing between them, using a wide flat metal spoon to scoop taho from one bucket, serving it. He is not wearing the shoulder pole while serving.",
  "magtatahip-rice-winnowing-scene": "A woman is standing, holding a flat, shallow circular winnowing tray (bilao) with both hands, tossing rice grains in the air to let the wind blow away the chaff. The tray is held in her hands, not resting on a table.",
  "manghuhula-bamboo-craftsman-scene": "A craftsman is using a simple bolo knife to split a bamboo stalk lengthwise, showing clean physical splits in the wood. Do not draw a T-shaped peg."
};

async function main() {
  const topicFiles = readdirSync(promptsDir).filter(f => f.endsWith('.json'));

  let patchCount = 0;

  for (const topicFile of topicFiles) {
    const topicPath = join(promptsDir, topicFile);
    const data = JSON.parse(readFileSync(topicPath, 'utf8'));
    let modified = false;

    for (const img of data.images) {
      if (CUSTOM_PATCHES[img.id]) {
        const patchText = CUSTOM_PATCHES[img.id];
        
        // Append the custom patch to the prompt if not already present
        if (!img.prompt.includes(patchText)) {
          img.prompt = img.prompt + " " + patchText;
          img.status = 'todo'; // Make sure it's queued for regeneration
          patchCount++;
          modified = true;
        }
      }
    }

    if (modified) {
      writeFileSync(topicPath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`Applied custom patches to ${topicFile}`);
    }
  }

  console.log(`Successfully applied ${patchCount} custom prompt patches.`);
}

main().catch(err => {
  console.error(err);
});
