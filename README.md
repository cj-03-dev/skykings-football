# SkyKings Elite Juniors ⚽

A 4v4 kids' football game for the browser. Pick your player, pick your club
(Real Madrid or FC Barcelona), pick your position, and play: first to 3 goals
wins. The AI plays everyone you don't control. Ibrahim is always the ball boy.

No install, no build step, no internet needed. Open `index.html` in a browser:

```
git clone https://github.com/cj-03-dev/skykings-football.git
cd skykings-football
open index.html          # or: python3 -m http.server 8000, then visit localhost:8000
```

## The squad

| Player   | Build                         | Skin      |
| -------- | ----------------------------- | --------- |
| Adhrith  | Taller than average           | `#c68642` |
| Arhaann  | Tall and muscular             | `#e9b78a` |
| Divyansh | Normal height                 | `#c5845c` |
| Ibrahim  | Short, sunglasses. Ball boy.  | `#f1c27d` |
| Niteesh  | Taller                        | `#e0ac69` |
| Reyansh  | Short                         | `#f1c27d` |
| Shaurya  | Tall, golden crown            | `#ffdbac` |
| Shreyas  | Average height                | `#785c50` |
| Advaith  | Above average height          | `#d2a18c` |

Skin tones are swatches from the Genesis Rose palette, and hair uses its
darkest browns. Each kid's height really changes their size on the pitch, and
their card stats follow from it: short kids are nippier, tall kids shoot harder
and reach further in goal.

## Look and feel

- **Load screen:** a 3D football, ray-traced per pixel in a WebGL shader with
  real truncated-icosahedron panels, curls in spinning at high speed with
  motion blur, crashes into centre stage with a flash and shockwave, and the
  title slams down while the game loads. Tap to skip. (A 2D ball stands in on
  devices without WebGL.)
- **Real 3D gameplay (WebGL, three.js):** every kid is a 3D model built from
  their data (height, skin tone, build, hair, Shaurya's crown, Ibrahim's
  sunglasses, shirt number on the back) and animated from the match: running,
  kicks, slide tackles, keeper dives, throw-ins and celebrations. Real-time
  shadows, a 3D ball that rolls with its true spin, goals with nets, tiered
  stands with a bouncing crowd, ad boards and floodlight pylons. A broadcast
  camera behind the near touchline follows the ball, dollies with the play
  and swings round to frame the net for goals. On wide phones the view widens
  to fill the screen.
- **No WebGL?** The game falls back to a 2.5D canvas view automatically.
- **Atmosphere:** a crowd that bobs and goes wild for goals, camera flashes,
  corner flags, kick dust, ball trails on shots, and confetti for every goal.
  An arrow at the screen edge shows where you are if you're out of shot.

## How a match works

- **4v4:** one goalkeeper, defender, midfielder and forward a side.
- **You pick** one kid, one club and one position. The other seven kids fill
  the remaining spots at random. *Shuffle* on the setup screen re-rolls them.
- **Pick Ibrahim** and you play as the ball boy: the 4v4 is all AI, and your
  job is to run round the track, pick the ball up when it goes out, and throw
  it back in.
- **No timer.** First to 3 goals wins.
- **Ball out of play:** no corners or goal kicks. Ibrahim fetches the ball and
  throws it to the side that didn't touch it last (to the keeper, if it went
  out over their own goal line).
- **Keepers** can use their hands only inside their own penalty box.
- **Difficulty** (Easy / Normal / Hard) sets how sharp the opposition is.
  Your AI teammates always play at the same steady level.

## Controls

| Action            | Keyboard               | Touch                 |
| ----------------- | ---------------------- | --------------------- |
| Move              | Arrows or `WASD`       | Left-thumb joystick   |
| Shoot             | `Space` (hold = power) | **Shoot**             |
| Pass              | `E`                    | **Pass**              |
| Call for the ball | `E` when a mate has it | **Call**              |
| Tackle            | `Q`                    | **Tackle**            |
| Save (keeper)     | `Q` in your own box    | **Save**              |
| Throw (ball boy)  | `Space` (hold = power) | **Throw**             |
| Pause             | `P` or `Esc`           | ❚❚ button             |
| Mute              | `M`                    | 🔊 button             |

Shooting: hold the stick up or down while you shoot to aim for that side of the
goal. The power bar's red zone is a gamble: a full-power blast from range
can sail over the bar.

## Sound

- **FAAH:** every shot that misses the goal (wide, or over the bar, even off
  the woodwork) plays the FAAH clip in `assets/faah.mp3`, and the crowd hushes
  under it. A shot the keeper saves or a defender blocks isn't a miss.
- **Match sounds:** referee's whistle (kick-off, ball out, goal, full time),
  kicks and touches, tackles, posts ringing, the crowd's "ooooh" at saves,
  and an air horn and roar for goals. A crowd bed follows the ball and gets
  louder near the goals. All synthesised in the browser, no extra files.
- Mute is remembered between visits.

## Files

| File            | What it holds                                                   |
| --------------- | --------------------------------------------------------------- |
| `index.html`    | The menus, overlays and touch controls.                          |
| `css/style.css` | All styling; phone portrait/landscape layouts.                   |
| `js/data.js`    | The squad, clubs, positions and difficulty numbers.              |
| `js/art.js`     | Drawing the kids, the ball and the club crests.                  |
| `js/match.js`   | Ball physics, rules, ball boy, and the AI.                       |
| `js/render3d.js`| The 3D match: stadium, 3D kids and their animation, camera.      |
| `js/render.js`  | Name tags, effects and HUD over the 3D view; the 2.5D fallback.  |
| `js/intro.js`   | The WebGL spinning-ball load screen.                             |
| `js/input.js`   | Keyboard and touch input.                                        |
| `js/audio.js`   | FAAH playback and the synthesised match sounds.                  |
| `js/ui.js`      | Menu flow: player, club, position, setup, full time.             |
| `js/main.js`    | The game loop.                                                   |
| `assets/faah.mp3` | The FAAH clip for missed shots.                                |
| `assets/fonts`  | Russo One and Barlow Condensed (SIL Open Font License).          |
| `assets/vendor` | three.js r147 (MIT), bundled so the game works offline.          |

`window.SK` exposes everything for poking at from the console. For example,
`SK.debug.speed = 8` fast-forwards a match.

Crests are drawn in each club's colours and layout as stylised stand-ins, not
official logos. This is a fan-made game for fun.
