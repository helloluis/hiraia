# Sample Scenes

This directory contains 5 sample scenes demonstrating Grade 6-7 Science concepts, each rendered as hand-drawn SVG illustrations.

## Samples

### 1. Gravity: Earth vs Moon (`gravity-earth-moon`)
**Concept:** Objects fall faster on Earth because it has stronger gravity  
**Elements:** 14 | **Render time:** 2.42ms  
**Features:**
- Stick figures on Earth and Moon
- Arrows showing gravitational force (stronger on Earth)
- Comparison of acceleration values (9.8 m/s² vs 1.6 m/s²)

### 2. States of Water (`water-states`)
**Concept:** Water changes state at different temperatures  
**Elements:** 25 | **Render time:** 2.24ms  
**Features:**
- Three containers showing ice, water, and steam
- Temperature ranges for each state
- Molecular representation (solid blocks, scattered circles, floating particles)
- Color coding: blue for cold, orange for hot

### 3. Photosynthesis (`photosynthesis`)
**Concept:** Plants use sunlight, water, and carbon dioxide to make glucose and oxygen  
**Elements:** 29 | **Render time:** 1.17ms  
**Features:**
- Sun with rays
- Leaf diagram
- Arrows showing inputs (sunlight, water, CO₂) and outputs (glucose, O₂)
- Chemical equation at bottom
- Soil and stem representation

### 4. Our Solar System (`solar-system`)
**Concept:** The Sun and planets in our solar system  
**Elements:** 2 (using figure template) | **Render time:** 1.51ms  
**Features:**
- Sun at center
- Orbital paths (dashed lines)
- Planets with labels
- Uses the `figure:solar` template for clean output

### 5. Simple Electrical Circuit (`electrical-circuit`)
**Concept:** A basic circuit with a battery, switch, and light bulb  
**Elements:** 20 | **Render time:** 1.63ms  
**Features:**
- Battery with +/- terminals
- Switch in ON position
- Light bulb
- Wire paths (blue for positive, red for negative)
- Current flow arrows
- Explanatory text

## Performance Summary

All samples rendered in **under 3ms** on a modern laptop, well below the 100ms target for low-end phones.

| Sample | Elements | Time (ms) |
|--------|----------|-----------|
| Gravity | 14 | 2.42 |
| Water States | 25 | 2.24 |
| Photosynthesis | 29 | 1.17 |
| Solar System | 2 | 1.51 |
| Circuit | 20 | 1.63 |
| **Average** | **18** | **1.79** |

## Rendering Samples

To render a sample:

```bash
cd packages/images
npx tsx render-sample.js samples/gravity-earth-moon.json
```

This will generate `samples/gravity-earth-moon.svg` which you can open in a browser.

## Sample Structure

Each JSON file follows the DSL contract:

```json
{
  "version": 1,
  "width": 600,
  "height": 400,
  "title": "Scene Title",
  "caption": "Optional caption",
  "elements": [
    {
      "type": "circle",
      "cx": 150,
      "cy": 100,
      "r": 40,
      "style": {
        "fill": "#ff0000",
        "stroke": "#000000"
      }
    }
  ],
  "style": {
    "fontFamily": "Comic Sans MS, cursive",
    "strokeWidth": 2,
    "roughness": 1.5
  }
}
```

## Educational Value

These samples demonstrate how the renderer can create:
- **Comparisons** (Earth vs Moon gravity)
- **Processes** (photosynthesis, water cycle)
- **Systems** (solar system, electrical circuit)
- **States** (solid, liquid, gas)

All appropriate for Grade 6-7 Science curriculum in the Philippines (DepEd K-12).
