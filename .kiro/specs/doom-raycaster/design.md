# Design Document: doom-raycaster

## Overview

The doom-raycaster is a browser-based first-person shooter built entirely from plain HTML, CSS, and JavaScript. It uses the raycasting technique — the same approach used by Wolfenstein 3D and the original Doom — to project a 2D grid map into a convincing 3D perspective on an HTML5 `<canvas>` element.

The entire game ships as a single `index.html` file (with optional co-located asset files). There is no build step, no server, and no external dependencies. Opening the file in a modern browser is sufficient to play.

The architecture is a classic game loop: read input → update state → render. All subsystems (raycaster, sprite renderer, collision, HUD, minimap, game state) are coordinated by a central `Game` object that owns the loop and delegates to specialised modules.

---

## Architecture

### High-Level Structure

```
index.html
├── <canvas id="gameCanvas">        — 3D view
├── <div id="hud">                  — Health / ammo overlay (HTML)
├── <div id="minimap">              — Minimap canvas overlay
├── <div id="overlay">              — Start / Game Over / Win screens
└── <script src="game.js">         — All game logic (or inline)
```

All JavaScript lives in one or a small number of plain `.js` files loaded via `<script>` tags. No modules, no bundler — just classic script loading so the game works on `file://`.

### Module Breakdown

```
Game                    — owns the game loop, wires subsystems together
├── InputHandler        — keyboard + mouse state + touch input aggregation
├── TouchControls       — touch event handling, joystick + look zone (mobile only)
├── MapLoader           — parses and validates the 2D map grid
├── Player              — position, direction, health, ammo
├── EnemyManager        — list of Enemy instances, proximity damage
├── Raycaster           — DDA wall-hit loop, produces RayResult[]
├── Renderer            — draws walls, floor/ceiling, sprites, minimap
├── TextureManager      — loads/caches textures, provides pixel samplers
├── HUD                 — updates DOM elements for health/ammo/flash
└── StateManager        — start / playing / gameover / win transitions
```

### Game Loop

```
requestAnimationFrame(loop)
  │
  ├── deltaTime = (now - lastTime) / 1000   // seconds
  ├── InputHandler.poll()
  ├── StateManager.update(deltaTime)
  │     ├── Player.update(deltaTime)        // movement + collision
  │     ├── EnemyManager.update(deltaTime)  // proximity damage
  │     └── ShootingSystem.update(deltaTime)// fire-rate cooldown
  ├── Raycaster.castAll(player, map)        // → RayResult[]
  ├── Renderer.drawFrame(rayResults, enemies, player, map)
  │     ├── drawCeilingAndFloor()
  │     ├── drawWalls(rayResults)
  │     ├── drawSprites(enemies, rayResults)
  │     └── drawMinimap()
  └── HUD.update(player)
```

Delta time is capped at 100 ms to prevent large jumps after tab switches or debugger pauses.

---

## Components and Interfaces

### InputHandler

Maintains a live snapshot of which keys are currently held and whether a mouse click occurred this frame. Also aggregates touch input from `TouchControls` into the same interface so all other subsystems remain unchanged.

```js
// Internal state
const keys = {};          // { 'KeyW': true, 'Space': false, … }
let mouseClicked = false; // consumed once per frame

// Touch-injected virtual axes (set each frame by TouchControls)
InputHandler._touchMoveX  = 0;  // -1 (back) to +1 (forward)
InputHandler._touchMoveY  = 0;  // unused (strafing not implemented)
InputHandler._touchRotate = 0;  // -1 (left) to +1 (right)
InputHandler._touchFired  = false;

// Public API
InputHandler.isHeld(code)       // → boolean
InputHandler.wasClicked()       // → boolean (clears flag)
InputHandler.hasFocus()         // → boolean (document has focus)
InputHandler.getTouchMove()     // → { x, y } normalised [-1, 1]
InputHandler.getTouchRotate()   // → number normalised [-1, 1]
InputHandler.wasTouchFired()    // → boolean (clears flag)
```

Listens to `keydown`, `keyup`, `mousedown`, and `blur` on `window`.

---

### TouchControls

Handles all touch events and writes normalised values into `InputHandler`. Only instantiated when `navigator.maxTouchPoints > 0`.

```js
const TouchControls = {
  init(inputHandler, canvas) { … },
  // Renders joystick ring + knob into #touch-controls overlay div
  // Tracks two independent touch IDs: one for joystick, one for look zone
  // On each touchmove: updates inputHandler._touchMoveX, _touchRotate
  // On tap in look zone: sets inputHandler._touchFired = true
}
```

**Layout:**
- `#touch-controls` — `position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none` — contains all touch UI
- `#joystick-zone` — left 50% of viewport, `pointer-events: auto`
- `#joystick-outer` — fixed circle, bottom-left, rendered via CSS
- `#joystick-knob` — inner circle, translated by touch delta clamped to outer radius
- `#look-zone` — right 50% of viewport, `pointer-events: auto`, transparent

**Touch ID tracking:**
```js
let joystickTouchId = null;   // touch controlling the joystick
let lookTouchId     = null;   // touch controlling look/shoot
let joystickOrigin  = null;   // { x, y } where joystick touch started
let lookStartPos    = null;   // { x, y, time } for tap detection
```

**Joystick normalisation:**
```
dx = touch.clientX - joystickOrigin.x
dy = touch.clientY - joystickOrigin.y
dist = Math.sqrt(dx*dx + dy*dy)
maxRadius = joystickOuter.radius (e.g. 60px)
normX = clamp(dx / maxRadius, -1, 1)   // rotation: left/right
normY = clamp(-dy / maxRadius, -1, 1)  // movement: up = forward
```

**Tap detection (look zone):**
```
elapsed = Date.now() - lookStartPos.time
moved   = distance(current, lookStartPos) < 10px
if elapsed < 200ms && moved: fire shot
```

---

### MapLoader

```js
MapLoader.load(grid)
// grid: number[][]
// Returns: { cells: number[][], width: number, height: number }
// Throws: Error if map is not fully enclosed or dimensions are out of range
```

Validation rules:
- Width and height must be in [8, 64].
- All cells in row 0, row (height-1), column 0, and column (width-1) must be non-zero.

---

### Player

```js
// State
player.x, player.y       // world position (float, map units)
player.angle             // facing direction (radians)
player.health            // 0–100
player.ammo              // 0–50
player.fireCooldown      // seconds remaining until next shot allowed
player.muzzleFlash       // seconds remaining for flash display

// Methods
player.update(dt, input, map)
player.takeDamage(amount)
player.shoot()           // returns true if shot was fired
```

Movement uses a direction vector derived from `player.angle`. Collision is resolved per-axis (see Collision section).

---

### Enemy

```js
// State
enemy.x, enemy.y         // world position
enemy.health             // starts at 100
enemy.alive              // boolean

// Computed each frame
enemy.distance           // distance to player (set by EnemyManager)
enemy.screenX            // projected screen column (set by Renderer)
```

---

### EnemyManager

```js
EnemyManager.update(dt, player)
// Iterates living enemies, computes distance to player,
// applies proximity damage (1 damage/second per enemy within 1.5 units)

EnemyManager.getLiving()   // → Enemy[]
EnemyManager.hitTest(ray)  // → Enemy | null  (for shooting)
```

---

### Raycaster

The core rendering primitive. For each screen column `x` (0 to `canvasWidth - 1`), it casts a ray and returns the wall hit data.

```js
// Input
Raycaster.castAll(player, map, canvasWidth, fov)

// Output: RayResult[]
{
  distance:    number,   // perpendicular distance to wall
  wallX:       number,   // fractional hit offset within wall cell (0–1)
  side:        0 | 1,    // 0 = N/S face, 1 = E/W face
  mapX:        number,   // grid cell X of hit wall
  mapY:        number,   // grid cell Y of hit wall
  wallType:    number,   // non-zero map value at hit cell
  rayDirX:     number,
  rayDirY:     number,
}
```

---

### TextureManager

```js
TextureManager.load(id, src)   // src = data URI or URL
TextureManager.get(id)         // → HTMLImageElement | null
TextureManager.sample(id, u, v) // → [r, g, b, a] (0–255 each)
// u, v are normalised [0,1] coordinates
```

Textures are drawn to an offscreen canvas once on load; pixel data is read via `getImageData` for fast per-pixel sampling during wall rendering.

---

### Renderer

```js
Renderer.drawFrame({
  ctx,           // CanvasRenderingContext2D
  rayResults,    // RayResult[]
  enemies,       // Enemy[]
  player,        // Player
  map,           // MapData
  textures,      // TextureManager
  showMinimap,   // boolean
})
```

Internally uses a `zBuffer` (Float32Array of length `canvasWidth`) populated during wall rendering and consulted during sprite rendering.

---

### HUD

Updates DOM elements — no canvas drawing.

```js
HUD.update(player)
// Sets textContent of #health, #ammo elements
// Toggles .flash class on #crosshair for muzzle flash
// Toggles .depleted class on #ammo when ammo === 0
```

---

### StateManager

```js
// States: 'start' | 'playing' | 'gameover' | 'win'
StateManager.current        // current state string
StateManager.transition(to) // changes state, shows/hides overlay
StateManager.update(dt, game) // delegates to active state's update fn
```

---

## Data Models

### MapData

```js
{
  cells:  number[][],  // [row][col], 0 = floor, 1–4 = wall type
  width:  number,      // columns
  height: number,      // rows
}
```

### RayResult

```js
{
  distance: number,   // perpendicular wall distance (map units)
  wallX:    number,   // hit offset within cell, 0.0–1.0
  side:     0 | 1,   // which face was hit
  mapX:     number,
  mapY:     number,
  wallType: number,
  rayDirX:  number,
  rayDirY:  number,
}
```

### GameConfig (constants)

```js
const CONFIG = {
  FOV:              66,          // degrees
  MOVE_SPEED:       3.0,         // map units per second
  ROT_SPEED:        2.5,         // radians per second
  PLAYER_RADIUS:    0.2,         // map units
  ENEMY_DAMAGE:     10,          // health per second per enemy
  ENEMY_RANGE:      1.5,         // map units
  SHOT_DAMAGE:      34,          // health per shot
  FIRE_RATE:        0.5,         // seconds between shots
  MUZZLE_FLASH_DUR: 0.1,         // seconds
  STARTING_HEALTH:  100,
  STARTING_AMMO:    50,
  TEXTURE_SIZE:     64,          // pixels (power of two)
  MINIMAP_CELL_PX:  6,           // pixels per map cell on minimap
  DARKEN_FACTOR:    5.0,         // distance multiplier for darkening
};
```

### Enemy Definition

```js
{
  id:       number,
  startX:   number,
  startY:   number,
  health:   number,   // default 100
  spriteId: string,   // key into TextureManager
}
```

---

## Algorithms

### DDA Raycasting

For each screen column `x`:

1. **Compute ray direction**
   ```
   cameraX = 2 * x / canvasWidth - 1          // -1 (left) to +1 (right)
   rayDirX = player.dirX + plane.x * cameraX
   rayDirY = player.dirY + plane.y * cameraX
   ```
   `plane` is the camera plane vector, perpendicular to the direction vector, with length `tan(FOV/2)`.

2. **Initialise DDA**
   ```
   mapX = floor(player.x)
   mapY = floor(player.y)
   deltaDistX = |1 / rayDirX|   // distance ray travels per X grid crossing
   deltaDistY = |1 / rayDirY|   // distance ray travels per Y grid crossing
   ```
   Compute initial `sideDistX` / `sideDistY` (distance to first X/Y grid line).

3. **Step loop** — advance to the nearest grid crossing until a wall is hit:
   ```
   while map[mapY][mapX] === 0:
     if sideDistX < sideDistY:
       sideDistX += deltaDistX
       mapX += stepX
       side = 0
     else:
       sideDistY += deltaDistY
       mapY += stepY
       side = 1
   ```

4. **Perpendicular distance** (eliminates fisheye):
   ```
   if side === 0: perpDist = sideDistX - deltaDistX
   else:          perpDist = sideDistY - deltaDistY
   ```

5. **Wall slice height**:
   ```
   sliceHeight = floor(canvasHeight / perpDist)
   drawStart = max(0, canvasHeight/2 - sliceHeight/2)
   drawEnd   = min(canvasHeight-1, canvasHeight/2 + sliceHeight/2)
   ```

6. **Texture column** (`wallX`):
   ```
   if side === 0: wallX = player.y + perpDist * rayDirY
   else:          wallX = player.x + perpDist * rayDirX
   wallX -= floor(wallX)   // fractional part only
   texCol = floor(wallX * TEXTURE_SIZE)
   ```

7. **Distance darkening**: multiply each sampled pixel's RGB by `clamp(1 - perpDist / DARKEN_FACTOR, 0.1, 1.0)`.

### Sprite Rendering

After all wall slices are drawn (and `zBuffer` is populated):

1. Compute each enemy's position relative to the player using the inverse camera matrix:
   ```
   dx = enemy.x - player.x
   dy = enemy.y - player.y
   invDet = 1 / (plane.x * dir.y - dir.x * plane.y)
   transformX = invDet * (dir.y * dx - dir.x * dy)
   transformY = invDet * (-plane.y * dx + plane.x * dy)
   ```
   `transformY` is the depth; skip if `transformY <= 0` (behind player).

2. Project to screen:
   ```
   screenX = floor((canvasWidth / 2) * (1 + transformX / transformY))
   spriteHeight = floor(canvasHeight / transformY)
   spriteWidth  = spriteHeight   // square sprites
   ```

3. Sort enemies by `transformY` descending (farthest first).

4. For each column of the sprite, only draw if `transformY < zBuffer[col]` (sprite is in front of wall).

5. Apply the same distance darkening as walls.

### Collision Detection (Wall Sliding)

Test the new position independently on each axis:

```
newX = player.x + moveX
newY = player.y + moveY

// X axis
if map[floor(player.y)][floor(newX + sign(moveX) * PLAYER_RADIUS)] === 0:
    player.x = newX

// Y axis
if map[floor(newY + sign(moveY) * PLAYER_RADIUS)][floor(player.x)] === 0:
    player.y = newY
```

This allows the player to slide along walls rather than stopping dead.

### Shooting Hit Test

When the player fires, cast a ray along the exact centre column (camera X = 0, i.e., straight ahead). Walk the DDA loop but also check each step against the sorted enemy list:

```
for each DDA step:
    for each living enemy:
        if enemy is within the current grid cell or adjacent:
            project enemy to screen
            if centre column falls within sprite's screen X range:
                if enemy.transformY < wallHitDistance:
                    return enemy as hit
```

This is a simplified version — in practice, check whether the ray passes through the sprite's bounding column range before the wall hit distance.

---

## Rendering Pipeline (Frame Order)

```
1. Clear canvas (or rely on ceiling/floor fill)
2. Draw ceiling (fillRect, top half, solid colour)
3. Draw floor   (fillRect, bottom half, solid colour)
4. For each column x (0 → canvasWidth-1):
     a. DDA → RayResult
     b. Store perpDist in zBuffer[x]
     c. Sample texture column, apply darkening
     d. putImageData or drawImage for the wall slice
5. Sort living enemies by distance (desc)
6. For each enemy (back to front):
     a. Project to screen
     b. For each sprite column within canvas bounds:
          if zBuffer[col] > enemy.transformY: draw pixel
7. Draw minimap (if visible) onto minimap canvas
8. HUD DOM update
```

For performance, wall pixels are written into a single `ImageData` buffer (`ctx.createImageData`) and flushed once per frame with `ctx.putImageData`, avoiding per-slice `drawImage` overhead.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Map not fully enclosed | `MapLoader.load` throws; `Game.init` catches, logs to console, shows error overlay |
| Map dimensions out of range | Same as above |
| Texture fails to load | `TextureManager.get` returns `null`; Renderer draws a solid magenta fallback colour |
| `requestAnimationFrame` not available | Detected at startup; error message shown in overlay |
| Player health ≤ 0 | `StateManager.transition('gameover')` called; game loop stops |
| All enemies dead | `StateManager.transition('win')` called; game loop stops |
| Ammo = 0 and player fires | `player.shoot()` returns false; no ray cast, no cooldown consumed |
| Canvas resize during play | `resize` event handler recalculates `canvasWidth`, `canvasHeight`, camera plane, and redraws immediately |

---

## Testing Strategy

This feature is a browser-based game with significant rendering logic, pure algorithmic components (DDA, projection math, collision), and stateful game logic. The testing approach uses both example-based unit tests and property-based tests.

### Unit Tests

Unit tests cover specific examples and edge cases:

- `MapLoader.load` rejects maps with open borders
- `MapLoader.load` rejects maps outside 8×8–64×64 bounds
- `Player.takeDamage` clamps health to [0, 100]
- `Player.shoot` returns false when ammo is 0
- `Player.shoot` enforces the 500 ms fire-rate cooldown
- `EnemyManager.update` applies damage only when enemy is within 1.5 units
- `EnemyManager.update` applies cumulative damage from multiple enemies
- `StateManager.transition` to `'gameover'` when health reaches 0
- `StateManager.transition` to `'win'` when all enemies are dead
- Sprite sort order (back-to-front by distance)

### Property-Based Tests

Property-based tests use a library such as [fast-check](https://github.com/dubzzz/fast-check) (loaded as a dev-only script, not a runtime dependency). Each test runs a minimum of 100 iterations.

Tag format: `Feature: doom-raycaster, Property N: <property text>`


---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Property-based testing is appropriate here because the game contains substantial pure algorithmic logic: the DDA raycasting math, projection formulas, collision resolution, damage accumulation, and sorting — all of which have universal properties that hold across a wide input space and where 100+ iterations will surface edge cases that hand-picked examples miss.

The property-based testing library used is [fast-check](https://github.com/dubzzz/fast-check), loaded as a dev-only script (not a runtime dependency of the game).

---

### Property 1: Delta-time movement scaling

*For any* positive delta time value `dt` and any player facing angle, the displacement applied to the player's position in one update step must equal exactly `MOVE_SPEED * dt` in the direction of movement (before collision resolution).

**Validates: Requirements 2.4, 6.3**

---

### Property 2: Map dimension validation

*For any* 2D integer grid, `MapLoader.load` must accept the grid if and only if both its width and height are in the range [8, 64]. Grids outside this range must be rejected with an error.

**Validates: Requirements 3.2**

---

### Property 3: Map enclosure validation

*For any* 2D integer grid with valid dimensions, `MapLoader.load` must reject the grid if any border cell (first/last row or first/last column) has value 0, and must accept the grid if all border cells are non-zero (assuming valid dimensions).

**Validates: Requirements 3.3**

---

### Property 4: Ray count equals canvas width

*For any* canvas width `W` (positive integer), `Raycaster.castAll` must return exactly `W` `RayResult` objects — one per screen column.

**Validates: Requirements 4.1**

---

### Property 5: DDA finds the nearest wall

*For any* player position and ray direction within a valid enclosed map, the perpendicular distance returned by the DDA algorithm must be less than or equal to the distance to any other wall cell that the ray passes through. The algorithm must never report a wall hit that is farther than the actual nearest intersection.

**Validates: Requirements 4.2, 4.6**

---

### Property 6: Projected height is inversely proportional to distance

*For any* perpendicular distance `d > 0` and canvas height `H`, the projected slice height (for both wall slices and enemy sprites) must equal `floor(H / d)`. Doubling the distance must halve the projected height.

**Validates: Requirements 4.3, 7.2**

---

### Property 7: Texture column sampling

*For any* wall hit offset `wallX` in [0, 1) and texture size `T`, the sampled texture column index must equal `floor(wallX * T)`, and must always be a valid index in [0, T-1].

**Validates: Requirements 5.1**

---

### Property 8: Distance darkening is monotonically non-increasing

*For any* two distances `d1 ≤ d2`, the darkening multiplier applied at `d1` must be greater than or equal to the multiplier applied at `d2`. The multiplier must always be clamped to the range [0.1, 1.0].

**Validates: Requirements 5.5**

---

### Property 9: Collision keeps player outside walls with minimum radius

*For any* player position and movement vector, after applying collision resolution, the player's position must not fall within any wall cell, and the player's distance to the nearest wall face must be at least `PLAYER_RADIUS` (0.2 map units) in both the X and Y axes.

**Validates: Requirements 6.4, 6.5**

---

### Property 10: Sprite billboard projection

*For any* player position, player angle, and enemy position (in front of the player), the enemy's projected screen X coordinate must be computed correctly using the inverse camera matrix transform, and must equal `floor((W / 2) * (1 + transformX / transformY))`.

**Validates: Requirements 7.1**

---

### Property 11: Sprite sort order is back-to-front

*For any* list of enemies with arbitrary distances from the player, after sorting for rendering, the enemies must appear in descending order of distance (farthest first, nearest last).

**Validates: Requirements 7.3**

---

### Property 12: Sprite depth clipping respects z-buffer

*For any* sprite and z-buffer configuration, no sprite pixel must be drawn in a screen column `c` where `zBuffer[c] ≤ sprite.transformY`. The sprite is only visible in columns where it is closer than the wall.

**Validates: Requirements 7.4**

---

### Property 13: Enemy death removes it from the living set

*For any* enemy with any starting health, after `takeDamage` reduces its health to 0 or below, `enemy.alive` must be `false` and `EnemyManager.getLiving()` must not include that enemy.

**Validates: Requirements 7.6**

---

### Property 14: Shot hit test detects enemies in centre column

*For any* enemy position, the shooting hit test must return that enemy as hit if and only if the enemy's projected sprite covers the centre screen column (`canvasWidth / 2`) and the enemy's depth is less than the wall distance at that column.

**Validates: Requirements 8.2**

---

### Property 15: Shot damage reduces enemy health by fixed amount

*For any* enemy with starting health `h` (where `h > 0`), after one successful hit, the enemy's health must equal `max(0, h - SHOT_DAMAGE)`.

**Validates: Requirements 8.3**

---

### Property 16: Fire rate cooldown prevents rapid firing

*For any* time interval `t < FIRE_RATE` (0.5 s) elapsed since the last successful shot, `player.shoot()` must return `false` and must not decrement ammo or reset the cooldown.

**Validates: Requirements 8.4**

---

### Property 17: Ammo depletion prevents firing

*For any* sequence of shots that exhausts all ammo, once `player.ammo === 0`, all subsequent calls to `player.shoot()` must return `false` and ammo must remain at 0.

**Validates: Requirements 8.6**

---

### Property 18: HUD values reflect player state

*For any* player health value `h` in [0, 100] and ammo value `a` in [0, 50], after calling `HUD.update(player)`, the health DOM element's text content must equal `h` and the ammo DOM element's text content must equal `a`.

**Validates: Requirements 9.2**

---

### Property 19: Minimap entity positions are correctly scaled

*For any* player position `(px, py)` and any set of living enemies with positions `(ex, ey)`, after drawing the minimap, the player marker must appear at pixel coordinates `(px * MINIMAP_CELL_PX, py * MINIMAP_CELL_PX)` and each enemy marker must appear at `(ex * MINIMAP_CELL_PX, ey * MINIMAP_CELL_PX)` on the minimap canvas.

**Validates: Requirements 10.2, 10.3**

---

### Property 20: Minimap size does not exceed 20% of canvas width

*For any* canvas width `W`, the minimap's rendered pixel width must be at most `floor(0.2 * W)`.

**Validates: Requirements 10.4**

---

### Property 21: Proximity damage is proportional to enemy count and time

*For any* player position, any number `N ≥ 0` of living enemies within 1.5 map units, and any delta time `dt`, the health reduction applied in one update step must equal exactly `N * ENEMY_DAMAGE * dt`. When `N = 0` (no enemies in range), no damage must be applied.

**Validates: Requirements 12.1, 12.2, 12.3**

---

### Property 22: Player health is always clamped to [0, 100]

*For any* sequence of `takeDamage` and healing operations with arbitrary values, `player.health` must always remain in the range [0, 100] inclusive.

**Validates: Requirements 12.4**
