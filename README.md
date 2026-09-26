# Pocket Universe

A gravity sandbox that runs in your browser. Throw planets, comets, stars and black holes into space and watch what gravity does with them: orbits, slingshots, collisions, tidal disruptions, supernovae and, if you're patient, life.

It's a single HTML file with no build step and no dependencies beyond two Google Fonts. Open `index.html` in any modern browser, or play it on GitHub Pages.

## How to play

| Action | Mouse / keyboard | Touch |
|---|---|---|
| Throw something | Drag (direction and length set its speed) | Drag |
| Make it heavier | Hold before letting go | Hold |
| Perfect circular orbit | Hold **Shift** while dragging, or turn on **Auto-orbit** (`O`) | Auto-orbit |
| Inspect and follow an object | Click it | Tap it |
| Zoom / pan | Scroll / right-drag | Pinch / two-finger drag |
| Pick a tool | `1` planet, `2` comet, `3` star, `4` black hole, `5` dust | Dock buttons |
| Pause, slow down, speed up | `Space`, `[`, `]` | Dock buttons |
| Trails, warp grid, habitable zones, sound | `T`, `G`, `Z`, `M` | Dock buttons |
| Center or follow, restart, stop inspecting | `F`, `R`, `Esc` | Dock buttons |

## Scenes

- **Galaxies collide**: two spiral galaxies pass through each other and throw off tidal tails.
- **Cradle of life**: a calm solar system with two worlds in the habitable zone. Run it at 4× and wait.
- **Black hole feast**: stars on plunging orbits around a 10 M☉ black hole. The ones that get too close are shredded.
- **Figure eight**: three equal stars chasing each other on the figure-eight orbit found by Cris Moore in 1993.
- **Solar system forming**: a young Sun in a disk of planetesimals that collide and grow into planets.
- **Binary star**: two suns with four circumbinary planets.
- **Mayhem**: twelve heavy stars in a tight cluster.
- **Empty space**: a blank canvas.

## What's simulated

- **N-body gravity** with a leapfrog integrator. Heavy bodies all attract each other; dust particles feel only the heavy bodies, so thousands of them stay cheap.
- **Real-ish units**: 1 AU, solar masses (M☉), Jupiter masses (M♃), years and km/s. A 1 AU orbit around a 1 M☉ star takes one year.
- **Stellar physics, simplified**: star color and spectral class come from mass. Planets that merge past 0.08 M☉ ignite into stars, and stars that merge past 20 M☉ collapse into black holes in a supernova. Bodies between 13 M♃ and 0.08 M☉ are brown dwarfs.
- **Tidal disruption**: a star or planet that crosses a black hole's tidal radius is torn into a stream of debris.
- **Habitable zones and life**: planets that receive between 0.42 and 1.1 times Earth's sunlight long enough develop life, then a civilization, then start launching probes. Drifting out of the zone, giant impacts and nearby supernovae wipe life out. Comet impacts give it a head start.
- **Comets**: ion tails point away from the star, dust tails curve behind, and shed dust spreads into a stream along the orbit.
- **Warp view**: a grid bent by every heavy mass, with gravitational-wave ripples when black holes merge.
