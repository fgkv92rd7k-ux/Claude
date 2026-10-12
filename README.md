# Monstrosity Bowl · Film Room edition

A phone-first 3D football game (the super team against the team built to beat it) with a study layer bolted on:
paste what you are learning and the coach quizzes you between drives. Right answers feed your team's momentum;
three in a row and your kick returner (Deion for the Monstrosity, Hester for the Antidote) gets the jets on the next kickoff.

No build step. Open `index.html` from any static server (or straight from disk) and play.

## Files

| File | Owns |
| --- | --- |
| `index.html` | Styles, the stage DOM (scoreboard, pad, sheets, overlay) and the script load order |
| `sim.js` | Teams, playbooks, routes; the play simulation (movement, blocking, passing, tackles, flags); downs, clock, scoring and the CPU coaches. No DOM, no Three.js |
| `render.js` | The Three.js stadium: field texture, instanced players with blob shadows, merged stadium geometry, camera rig, particles |
| `ui.js` | Settings, sound, joystick and keys, play-call sheet, kick meter, HUD, overlays, the frame loop, and the Film Room hooks (momentum, when to ask) |
| `study.js` | The Film Room: decks, SM-2 spaced repetition, the question sheet, parsers for pasted notes, Claude-made cards, backup |
| `decks.js` | Built-in decks (World Geography, Real Analysis), generated from `decks/*.json` by `tools/build-decks.mjs` |

The five scripts are classic scripts that share one global lexical scope, loaded in the order listed in `index.html`.

## Film Room

- **Load notes** from the title screen (Film Room tile) or the pause menu. Four shapes are understood:
  `Q: … / A: …` pairs; one flashcard per line as `term | definition` (also tab, `::`, `—`, `-`, or `term: definition`);
  a JSON backup made by Export; and free text. Free text becomes questions written by Claude when the page runs inside
  claude.ai (the artifact's `sample` capability, which asks you once for permission and uses your own Claude usage);
  offline it becomes fill-in-the-blank cards cut from your sentences.
- **Scheduling** is SM-2: a miss comes back in ten minutes; a hit comes back after 1, 3, then ef× days.
- **Cadence**: at every change of possession (default), each quarter, every four plays, or never in game; plus an idle
  timer that asks while you sit on the title, the pause menu or the play-call sheet.
- **Progress** lives in the browser's localStorage. Export writes a JSON backup (a real download inside claude.ai,
  otherwise the text to copy); paste it into the notes box to restore on another device.

## Why it is slimmer than the original

| | Original | Now |
| --- | --- | --- |
| Draw calls per frame | ~500 (22 figures × ~22 meshes, 48 bench meshes, ~100 stadium boxes) | ~38 (one InstancedMesh per body part, merged stadium, instanced benches) |
| Shadows | 2048² PCF-soft shadow map, every part a caster | Flat blob shadows, one instanced draw |
| Resolution | Dropped to 1× device pixels under load (blurry) | Never below 1.5×; antialias kept |
| Renderers | 3D plus a retro 2D pixel renderer and glyph font | 3D only |
| Shape | One 1,833-line file | Five modules you can read on their own |

## Develop

```
npm run serve         # http://localhost:8080
npm test              # headless Chromium smoke test (software WebGL): plays a CPU stretch, exercises the Film Room, screenshots in test/
npm run build:decks   # decks/*.json -> decks.js
npm run build:page    # dist/page.html, the body-only shape the claude.ai Artifact tool publishes
```

`npm test` needs Playwright and a Chromium; set `THREE_LOCAL=/path/to/three.min.js` on machines that cannot reach the CDN.
