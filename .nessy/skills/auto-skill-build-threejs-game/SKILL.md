---
name: build-threejs-game
description: Build a complete browser-based 3D game with Three.js using procedural geometry, validate with headless Chrome, and iterate on visual feedback
source: auto-skill
extracted_at: '2026-10-01T09:45:00.000Z'
---

## Overview
When asked to build a browser-based 3D game or scene with Three.js, use this procedure to scaffold, implement, validate, and iterate — all within a single project directory.

## Procedure

### 1. Scaffold three files
Create `index.html`, `style.css`, and `game.js` in the project root. Load Three.js from CDN (`r128` or latest stable).

### 2. Implement in phases (one file each, or all in game.js)
- **Scene setup** — renderer (with `PCFSoftShadowMap`, `ACESFilmicToneMapping`, `sRGBEncoding`), scene, camera, sky shader, fog
- **Environment** — ground, road, procedural textures (canvas-based), trees, signs, infrastructure
- **Characters** — build from primitives (spheres, boxes, cylinders); match reference images for hair color, clothing, skin tone
- **Vehicles** — build from primitives with recognizable features (grille, headlights, taillights, wheels, mirrors, badges)
- **Game logic** — state machine (menu → playing → won/lost), input handling, win/lose conditions
- **UI overlays** — start screen, HUD (distance bar, speed hint), win/lose screens with buttons

### 3. Validate with headless Chrome
```bash
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
$CH --headless=new --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader \
    --virtual-time-budget=12000 --window-size=1280,720 \
    --screenshot=/tmp/screenshot.png "file://$(pwd)/index.html"
```
- `--use-angle=swiftshader` enables software WebGL (required in headless)
- Check console for JS errors: `grep -iE "CONSOLE|Error|Exception" /tmp/log | grep -viE "extension|gpu|gl_|angle|swiftshader"`
- View screenshot to verify scene composition, camera framing, UI layout

### 4. Test gameplay states
For win/lose screens, create modified copies that trigger conditions immediately:
```js
// Force win on first frame
gameContent.replace('WIN_GAP: 66,', 'WIN_GAP: 10,');
// Force lose on first frame
gameContent.replace('LOSE_GAP: 4,', 'LOSE_GAP: 40,');
```
Inject a single Space key event to start the game:
```js
function s(){document.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',bubbles:true}));}
window.addEventListener('load',function(){setTimeout(s,300);});
```

### 5. Iterate on visual feedback
Common issues and fixes:
- **UI covering important scene elements** — restructure overlay layout (title top, controls bottom-left, center open for scene)
- **`position: fixed` element pushed off-screen** — if an element with `position: fixed` is inside a parent with `transform`, it becomes relative to that parent, not the viewport. Move it to be a direct child of `body`/`#game-container`.
- **HUD element not hiding on menu screen** — if you moved an element out of `#hud` to fix the `fixed` positioning bug, it won't be controlled by `hud.classList.toggle('hidden', ...)`. Add separate visibility control: `speedHint.classList.toggle('hidden', name !== 'playing')`.
- **Cars not visible in menu shot** — reposition camera to frame both vehicles (chase angle behind pursuer, looking forward)
- **Characters too large/small for cabin** — scale with `group.scale.setScalar(0.6)` and adjust position
- **Wheel spin not working** — collect wheel groups in an array at creation time instead of traversing at runtime
- **Scenery not scrolling correctly** — use relative wrapping (`spawnZ -= span`) instead of resetting to fixed positions
- **Camera not revealing pursuer** — dynamically adjust camera distance based on gap; pull back when pursuer is close

### 6. Character building tips
- **Skin**: `0xe8b48c` (light), `0xd9a071` (medium)
- **Hair colors**: `0x171110` (black), `0x3a2c22` (dark brown), `0x4a2c18` (chestnut)
- **Short hair**: sphere scaled down on Y, slightly larger than head
- **Long hair**: sphere + cone (fall) behind head
- **Bun**: sphere + small sphere on top/back
- **Clothing**: box geometries with appropriate colors; dress = torso box + cylinder skirt
- **Anatomy for animation**: wrap each arm in a `THREE.Group` pivot at the shoulder joint so you can rotate `armPivot.rotation.x` for waving. Store pivots in `userData.arms`.

### 7. Intro cutscene with animated characters
Build standalone actor groups outside vehicles, then animate a scripted sequence on the menu loop:

1. **Create actors** — call the same `buildMan()` / `buildWoman()` functions used for in-car characters, but place them on the ground near the vehicles. Add to scene separately.
2. **Tag pivot groups** — in character builders, store arm pivot groups in `userData.arms` and head in `userData.head` so you can animate them at runtime.
3. **Hide in-car occupants during menu** — set `playerCar.group.userData.driver.visible = false` and `enemyCar.userData.occupants.forEach(o => o.visible = false)`.
4. **Define cutscene phases** — use a cycle duration `T` and time-based interpolation:
   - Phase 1 (0–7s): characters stand near car, women wave arms toward man, man waves off
   - Phase 2 (7–10s): man walks to car door, scales down (shrinks to fit cabin), in-car driver fades in
   - Phase 3 (10–14s): car drives forward, women chase a few steps, raise arms
5. **Camera transition** — during cutscene, camera frames the characters beside the car; as the car drives away, camera smoothly follows. After start, switch to chase camera.
6. **On game start** — hide all cutscene actors, show in-car occupants, begin chase loop.

```js
const CUT = { T: 14, manHome: {x, z}, seat: {x, y, z}, womanA: {x, z}, womanB: {x, z} };
function updateCutscene(t) {
    const tt = t % CUT.T;
    const getIn = ease(clamp((tt - 7) / 3, 0, 1));
    const driving = ease(clamp((tt - 10) / 4, 0, 1));
    // interpolate positions, scales, visibility
    // animate arm rotations: actor.userData.arms[0].rotation.x = -0.7 + wave * 0.4;
}
```

### 8. Vehicle building tips
- **Body**: main box + hood/roof/taillight boxes
- **Windows**: dark material with `transparent: true, opacity: 0.45`
- **Wheels**: cylinder group (tire + hub cap), collect for spin animation
- **Details**: grille, headlights (emissive white), taillights (emissive red), mirrors, roof rails
- **Characters inside**: build separate group, position in cabin, scale to fit

## Key constraints
- Single HTML file + CSS + JS — no build step, no external assets
- Three.js r128+ from CDN
- All textures procedural (canvas-based)
- All models built from Three.js primitives
- No external model files or image assets needed
