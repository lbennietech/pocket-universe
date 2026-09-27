# Pocket Universe

A gravity sandbox that runs in your browser. Throw planets, comets, stars and black holes into space and watch what gravity does with them: orbits, slingshots, collisions, tidal disruptions, supernovae and, if you're patient, life.

**Play it:** https://lbennietech.github.io/pocket-universe/

It's a single HTML file with no build step and no dependencies beyond two Google Fonts. Open `index.html` in any modern browser, or play it on GitHub Pages.

## How to play

| Action | Mouse / keyboard | Touch |
|---|---|---|
| Move around | Drag | Drag with one finger |
| Zoom | Scroll, or `+` / `-` | Pinch |
| Inspect and follow an object | Click it. Click empty space to close. | Tap it |
| Throw something | Hold **Ctrl** (**⌘** on a Mac) and drag. The drag's direction and length set its speed. | Touch and hold until the ring fills, then drag |
| Make it bigger | Hold still before you drag, or scroll while placing | Keep holding still, or pinch with a second finger |
| Perfect circular orbit | Hold **Shift** as well, or turn on **Auto-orbit** (`O`) | Auto-orbit button |
| Cancel a throw | `Esc` (works while Ctrl is still held) | — |
| Pick what to throw | `1` planet, `2` comet, `3` star, `4` black hole, `5` dust | Dock buttons |
| Pause | `Space` | Pause button |
| Change speed | Speed slider, or `[` / `]`. Click the readout to reset. | Speed slider |
| Trails, warp grid, habitable zones | `T`, `G`, `Z` (switched-on settings glow blue; the tool you're holding glows gold) | Dock buttons |
| Center or follow, restart, stop inspecting | `F`, `R`, `Esc` | Dock buttons |
| Show the controls and the scene's description again | `H` or the **?** button | **?** button |

**Speed.** The slider runs from about 3 hours to more than a year of simulated time per real second. It starts at 9 days a second, and the readout shows the current rate.

**Sizes.** Holding still grows the object smoothly from its default toward its maximum in about four seconds. The ring around it shows how far along the range you are.

| Object | Lightest | Default | Heaviest |
|---|---|---|---|
| Planet | 3 Earth masses | 1 Jupiter mass | 82 Jupiter masses (a brown dwarf) |
| Star | 0.08 M☉ (a red dwarf) | 1 M☉ | 100 M☉ (a blue hypergiant) |
| Black hole | 3 M☉ | 5 M☉ | 1,000 M☉ |
| Dust cloud | 20 particles | 150 particles | 3,000 particles |

## Scenes

- **Galaxies collide**: two spiral galaxies pass through each other and throw off tidal tails.
- **Cradle of life**: a calm solar system with two worlds in the habitable zone. Turn the speed up and wait.
- **Black hole feast**: stars on plunging orbits around a 10 M☉ black hole. The ones that get too close are shredded.
- **Figure eight**: three equal stars chasing each other on the figure-eight orbit found by Cris Moore in 1993.
- **Solar system forming**: a young Sun in a disk of planetesimals that collide and grow into planets.
- **Binary star**: two suns with four circumbinary planets.
- **Mayhem**: twelve heavy stars in a tight cluster.
- **Empty space**: a blank canvas.

## What's simulated

- **N-body gravity** with a leapfrog integrator. Heavy bodies all attract each other; dust particles feel only the heavy bodies, so thousands of them stay cheap.
- **Real-ish units**: 1 AU, solar masses (M☉), Jupiter masses (M♃), years and km/s. A 1 AU orbit around a 1 M☉ star takes one year.
- **Stellar physics, simplified**: star color and spectral class come from mass, from deep-red dwarfs to blue hypergiants. Planets that merge past 0.08 M☉ ignite into stars. Star mergers that pass 20 M☉ collapse into a black hole in a supernova. Bodies between 13 M♃ and 0.08 M☉ are brown dwarfs.
- **Planet types**: ocean, jungle, desert, rocky, barren, lava and ice worlds, banded gas and ice giants, and magenta brown dwarfs. Zoom in to see surface patches and cloud bands.
- **Tidal disruption**: a star or planet that crosses a black hole's tidal radius is torn into a stream of debris.
- **Habitable zones and life**: planets that receive between 0.42 and 1.1 times Earth's sunlight long enough develop life, then a civilization, then start launching probes. Drifting out of the zone, giant impacts and nearby supernovae wipe life out. Comet impacts give it a head start.
- **Comets**: green comas, ion tails that point away from the star, curved dust tails, and shed dust that spreads into a stream along the orbit.
- **Supernova remnants** glow in hydrogen red, oxygen teal and hot white, like the Crab Nebula.
- **Warp view**: a grid bent by every heavy mass, with gravitational-wave ripples when black holes merge.

## Development

The game is `index.html`; there's nothing to build. To check a change, run the automated tests, which need Python 3.10+ and Chrome or Edge:

```
python tests/run_tests.py            # scripted mouse, touch and keyboard checks
python tests/run_tests.py --screens  # also saves desktop and phone screenshots to tests/output/
```

## Author

Created by **Luke Bennie** ([lukebennie@gmail.com](mailto:lukebennie@gmail.com)).

## License

Copyright © 2026 Luke Bennie. All rights reserved. See [LICENSE](LICENSE) for the terms.

The fonts, [IBM Plex](https://github.com/IBM/plex) and [Syne](https://github.com/bonjourmonde/Syne), load from Google Fonts and are licensed separately under the SIL Open Font License 1.1.
