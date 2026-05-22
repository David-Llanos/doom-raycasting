# Implementation Plan: doom-raycaster

## Overview

Implement a Doom-inspired first-person raycasting game as a single static HTML/JS/CSS deliverable. The implementation follows the architecture defined in the design document: a central `Game` object wiring together `InputHandler`, `MapLoader`, `Player`, `EnemyManager`, `Raycaster`, `Renderer`, `TextureManager`, `HUD`, and `StateManager`. All code is plain JavaScript with no build step or external runtime dependencies.

Property-based tests use [fast-check](https://github.com/dubzzz/fast-check) loaded as a dev-only `<script>` tag in a separate `tests.html` file. Unit tests use a minimal hand-rolled test harness in the same file.

---

## Tasks

- [x] 1. Scaffold project files and shared constants
  - Create `index.html` with `<canvas id="gameCanvas">`, `<div id="hud">`, `<div id="minimap">`, `<div id="overlay">`, and `<script src="game.js">` tags
  - Create `game.js` as the single JavaScript entry point
  - Define the `CONFIG` constants object (`FOV`, `MOVE_SPEED`, `ROT_SPEED`, `PLAYER_RADIUS`, `ENEMY_DAMAGE`, `ENEMY_RANGE`, `SHOT_DAMAGE`, `FIRE_RATE`, `MUZZLE_FLASH_DUR`, `STARTING_HEALTH`, `STARTING_AMMO`, `TEXTURE_SIZE`, `MINIMAP_CELL_PX`, `DARKEN_FACTOR`) exactly as specified in the design
  - Create `tests.html` that loads `game.js` and fast-check from a CDN script tag (dev-only), and contains a minimal test runner that reports pass/fail to the DOM
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Implement `InputHandler`
  - [x] 2.1 Implement `InputHandler` module
    - Maintain `keys` map updated by `keydown`/`keyup` listeners on `window`
    - Maintain `mouseClicked` flag set by `mousedown`, consumed and cleared by `wasClicked()`
    - Implement `isHeld(code)`, `wasClicked()`, and `hasFocus()` (checks `document.hasFocus()`)
    - Attach `blur` listener to clear all held keys when window loses focus
    - _Requirements: 6.1, 6.2, 6.6_

  - [x]* 2.2 Write unit tests for `InputHandler`
    - Test that `isHeld` returns true only for keys currently pressed
    - Test that `wasClicked()` returns true once then false on the next call (consumed flag)
    - Test that `hasFocus()` returns false after a simulated blur event
    - _Requirements: 6.6_

- [x] 3. Implement `MapLoader`
  - [x] 3.1 Implement `MapLoader.load(grid)`
    - Return `{ cells, width, height }` for valid grids
    - Throw a descriptive `Error` if width or height is outside [8, 64]
    - Throw a descriptive `Error` if any border cell (row 0, row height-1, col 0, col width-1) is 0
    - _Requirements: 3.1, 3.2, 3.3_

  - [x]* 3.2 Write unit tests for `MapLoader`
    - Test rejection of a 7×8 grid (too narrow)
    - Test rejection of a 65×65 grid (too large)
    - Test rejection of a valid-size grid with an open border cell
    - Test acceptance of a minimal valid 8×8 fully-enclosed grid
    - _Requirements: 3.2, 3.3_

  - [x]* 3.3 Write property test for map dimension validation (Property 2)
    - **Property 2: Map dimension validation**
    - For any 2D integer grid, `MapLoader.load` accepts if and only if both width and height are in [8, 64]
    - **Validates: Requirements 3.2**

  - [x]* 3.4 Write property test for map enclosure validation (Property 3)
    - **Property 3: Map enclosure validation**
    - For any valid-dimension grid, `MapLoader.load` rejects if any border cell is 0 and accepts if all border cells are non-zero
    - **Validates: Requirements 3.3**

- [x] 4. Implement `Player`
  - [x] 4.1 Implement `Player` state and `takeDamage`
    - Initialise `x`, `y`, `angle`, `health` (100), `ammo` (50), `fireCooldown` (0), `muzzleFlash` (0)
    - Implement `takeDamage(amount)`: subtract from health and clamp to [0, 100]
    - _Requirements: 12.4_

  - [x]* 4.2 Write unit tests for `Player.takeDamage`
    - Test that health is clamped to 0 when damage exceeds current health
    - Test that health cannot exceed 100
    - _Requirements: 12.4_

  - [x]* 4.3 Write property test for health clamping (Property 22)
    - **Property 22: Player health is always clamped to [0, 100]**
    - For any sequence of `takeDamage` calls with arbitrary positive values, `player.health` must remain in [0, 100]
    - **Validates: Requirements 12.4**

  - [x] 4.4 Implement `Player.shoot()`
    - Return `false` and do nothing if `ammo === 0` or `fireCooldown > 0`
    - Otherwise decrement `ammo`, set `fireCooldown = CONFIG.FIRE_RATE`, set `muzzleFlash = CONFIG.MUZZLE_FLASH_DUR`, return `true`
    - _Requirements: 8.4, 8.6_

  - [x]* 4.5 Write unit tests for `Player.shoot`
    - Test that `shoot()` returns false when ammo is 0
    - Test that `shoot()` returns false when `fireCooldown > 0`
    - Test that `shoot()` decrements ammo and sets cooldown on success
    - _Requirements: 8.4, 8.6_

  - [x]* 4.6 Write property test for fire rate cooldown (Property 16)
    - **Property 16: Fire rate cooldown prevents rapid firing**
    - For any `t < FIRE_RATE` elapsed since last shot, `player.shoot()` must return false and must not decrement ammo
    - **Validates: Requirements 8.4**

  - [x]* 4.7 Write property test for ammo depletion (Property 17)
    - **Property 17: Ammo depletion prevents firing**
    - After exhausting all ammo, all subsequent `player.shoot()` calls must return false and ammo must remain 0
    - **Validates: Requirements 8.6**

  - [x] 4.8 Implement `Player.update(dt, input, map)`
    - Compute movement delta from held keys (`W`/`ArrowUp`, `S`/`ArrowDown`) scaled by `CONFIG.MOVE_SPEED * dt`
    - Compute rotation delta from held keys (`A`/`ArrowLeft`, `D`/`ArrowRight`) scaled by `CONFIG.ROT_SPEED * dt`
    - Apply per-axis collision resolution (see design Collision section) using `CONFIG.PLAYER_RADIUS`
    - Decrement `fireCooldown` and `muzzleFlash` by `dt`, clamping to 0
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x]* 4.9 Write property test for delta-time movement scaling (Property 1)
    - **Property 1: Delta-time movement scaling**
    - For any positive `dt` and facing angle, the displacement applied must equal `MOVE_SPEED * dt` before collision resolution
    - **Validates: Requirements 2.4, 6.3**

  - [ ]* 4.10 Write property test for collision wall clearance (Property 9)
    - **Property 9: Collision keeps player outside walls with minimum radius**
    - After collision resolution, player position must not be within any wall cell and must be at least `PLAYER_RADIUS` from any wall face on both axes
    - **Validates: Requirements 6.4, 6.5**

- [x] 5. Checkpoint — core data and player logic
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement `TextureManager`
  - [x] 6.1 Implement `TextureManager.load`, `get`, and `sample`
    - `load(id, src)`: create an `HTMLImageElement`, set `src`, draw to an offscreen canvas on `onload`, store `ImageData` for fast pixel access
    - `get(id)`: return the `HTMLImageElement` or `null` if not loaded
    - `sample(id, u, v)`: return `[r, g, b, a]` by indexing into the stored `ImageData`; return `[255, 0, 255, 255]` (magenta) if texture not loaded
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x]* 6.2 Write unit tests for `TextureManager`
    - Test that `sample` returns magenta `[255, 0, 255, 255]` when texture is not loaded
    - Test that `sample` returns a valid RGBA array for a loaded texture
    - _Requirements: 5.4_

  - [x]* 6.3 Write property test for texture column sampling (Property 7)
    - **Property 7: Texture column sampling**
    - For any `wallX` in [0, 1) and texture size `T`, the sampled column index must equal `floor(wallX * T)` and be in [0, T-1]
    - **Validates: Requirements 5.1**

- [x] 7. Implement `Raycaster`
  - [x] 7.1 Implement `Raycaster.castAll(player, map, canvasWidth, fov)`
    - For each column `x` in [0, canvasWidth-1], compute `cameraX`, `rayDirX`, `rayDirY` from the player direction and camera plane
    - Run the DDA loop: initialise `mapX`, `mapY`, `deltaDistX`, `deltaDistY`, `sideDistX`, `sideDistY`, `stepX`, `stepY`; advance until a non-zero map cell is hit
    - Compute perpendicular distance (not Euclidean) to eliminate fisheye
    - Compute `wallX` (fractional hit offset within cell)
    - Return an array of `RayResult` objects with all fields from the design data model
    - _Requirements: 4.1, 4.2, 4.3, 4.6_

  - [x]* 7.2 Write property test for ray count equals canvas width (Property 4)
    - **Property 4: Ray count equals canvas width**
    - For any positive integer canvas width `W`, `Raycaster.castAll` must return exactly `W` `RayResult` objects
    - **Validates: Requirements 4.1**

  - [ ]* 7.3 Write property test for DDA nearest wall (Property 5)
    - **Property 5: DDA finds the nearest wall**
    - For any player position and ray direction in a valid enclosed map, the returned perpendicular distance must be ≤ the distance to any other wall cell the ray passes through
    - **Validates: Requirements 4.2, 4.6**

  - [x]* 7.4 Write property test for projected height inversely proportional to distance (Property 6)
    - **Property 6: Projected height is inversely proportional to distance**
    - For any perpendicular distance `d > 0` and canvas height `H`, the projected slice height must equal `floor(H / d)`; doubling distance must halve height
    - **Validates: Requirements 4.3, 7.2**

- [x] 8. Implement `Renderer` — walls and floor/ceiling
  - [x] 8.1 Implement ceiling and floor drawing
    - Fill the top half of the canvas with the ceiling colour using `fillRect`
    - Fill the bottom half with the floor colour using `fillRect`
    - _Requirements: 4.4_

  - [x] 8.2 Implement wall slice rendering with textures and darkening
    - Create a single `ImageData` buffer (`ctx.createImageData`) for the full canvas width
    - For each `RayResult`, compute `sliceHeight`, `drawStart`, `drawEnd`
    - For each pixel row in the slice, compute the texture row, call `TextureManager.sample`, apply distance darkening multiplier `clamp(1 - perpDist / CONFIG.DARKEN_FACTOR, 0.1, 1.0)`, write RGBA into the `ImageData` buffer
    - Flush the buffer once per frame with `ctx.putImageData`
    - Populate `zBuffer[x] = perpDist` for each column
    - _Requirements: 4.3, 5.1, 5.3, 5.5_

  - [x]* 8.3 Write property test for distance darkening monotonicity (Property 8)
    - **Property 8: Distance darkening is monotonically non-increasing**
    - For any `d1 ≤ d2`, the darkening multiplier at `d1` must be ≥ the multiplier at `d2`; multiplier must always be in [0.1, 1.0]
    - **Validates: Requirements 5.5**

- [x] 9. Implement `EnemyManager` and `Enemy`
  - [x] 9.1 Implement `Enemy` data structure and `EnemyManager`
    - Define `Enemy` with fields `x`, `y`, `health`, `alive`, `distance`, `screenX`
    - Implement `EnemyManager.update(dt, player)`: iterate living enemies, compute distance to player, apply `CONFIG.ENEMY_DAMAGE * dt` per enemy within `CONFIG.ENEMY_RANGE`, call `player.takeDamage`
    - Implement `EnemyManager.getLiving()`: return enemies where `alive === true`
    - Implement `EnemyManager.hitTest(ray)`: return the first living enemy whose sprite covers the centre column and is closer than the wall hit distance, or `null`
    - Mark `enemy.alive = false` when `enemy.health <= 0`
    - _Requirements: 7.5, 7.6, 12.1, 12.2, 12.3_

  - [x]* 9.2 Write unit tests for `EnemyManager`
    - Test that damage is applied only when enemy is within 1.5 units
    - Test that cumulative damage from multiple enemies is applied correctly
    - Test that `getLiving()` excludes enemies with health ≤ 0
    - _Requirements: 7.6, 12.1, 12.2, 12.3_

  - [x]* 9.3 Write property test for enemy death removes from living set (Property 13)
    - **Property 13: Enemy death removes it from the living set**
    - For any enemy with any starting health, after `takeDamage` reduces health to ≤ 0, `enemy.alive` must be false and `getLiving()` must not include that enemy
    - **Validates: Requirements 7.6**

  - [x]* 9.4 Write property test for proximity damage proportional to count and time (Property 21)
    - **Property 21: Proximity damage is proportional to enemy count and time**
    - For any `N ≥ 0` enemies within range and any `dt`, health reduction must equal `N * ENEMY_DAMAGE * dt`; when `N = 0`, no damage is applied
    - **Validates: Requirements 12.1, 12.2, 12.3**

- [x] 10. Implement sprite rendering in `Renderer`
  - [x] 10.1 Implement sprite projection and sorting
    - For each living enemy, compute `dx`, `dy` relative to player, apply inverse camera matrix to get `transformX`, `transformY`
    - Skip enemies where `transformY <= 0` (behind player)
    - Compute `screenX`, `spriteHeight`, `spriteWidth` from `transformY`
    - Sort enemies by `transformY` descending (farthest first)
    - _Requirements: 7.1, 7.2, 7.3_

  - [x]* 10.2 Write property test for sprite billboard projection (Property 10)
    - **Property 10: Sprite billboard projection**
    - For any player position/angle and enemy position in front of the player, the projected `screenX` must equal `floor((W / 2) * (1 + transformX / transformY))`
    - **Validates: Requirements 7.1**

  - [x]* 10.3 Write property test for sprite sort order (Property 11)
    - **Property 11: Sprite sort order is back-to-front**
    - For any list of enemies with arbitrary distances, after sorting, enemies must appear in descending order of distance (farthest first)
    - **Validates: Requirements 7.3**

  - [x] 10.4 Implement per-column sprite drawing with z-buffer clipping
    - For each sprite column within canvas bounds, only draw pixels where `transformY < zBuffer[col]`
    - Apply the same distance darkening formula as walls
    - Clip sprite vertical extent to canvas bounds
    - _Requirements: 7.2, 7.4_

  - [ ]* 10.5 Write property test for sprite depth clipping (Property 12)
    - **Property 12: Sprite depth clipping respects z-buffer**
    - No sprite pixel must be drawn in column `c` where `zBuffer[c] ≤ sprite.transformY`
    - **Validates: Requirements 7.4**

- [x] 11. Implement shooting system
  - [x] 11.1 Wire `Player.shoot()` to `EnemyManager.hitTest` and enemy damage
    - When `player.shoot()` returns true, call `EnemyManager.hitTest` with the centre-column ray result
    - If an enemy is returned, call `enemy.takeDamage(CONFIG.SHOT_DAMAGE)` (or reduce health directly by `CONFIG.SHOT_DAMAGE`, clamped to 0)
    - _Requirements: 8.1, 8.2, 8.3_

  - [x]* 11.2 Write unit tests for shooting
    - Test that a shot reduces the target enemy's health by `SHOT_DAMAGE`
    - Test that a shot does not affect enemies not in the centre column
    - Test that shooting when ammo is 0 does not call `hitTest`
    - _Requirements: 8.2, 8.3, 8.6_

  - [x]* 11.3 Write property test for shot damage fixed amount (Property 15)
    - **Property 15: Shot damage reduces enemy health by fixed amount**
    - For any enemy with starting health `h > 0`, after one hit, health must equal `max(0, h - SHOT_DAMAGE)`
    - **Validates: Requirements 8.3**

  - [ ]* 11.4 Write property test for shot hit test centre column (Property 14)
    - **Property 14: Shot hit test detects enemies in centre column**
    - For any enemy position, the hit test must return that enemy if and only if its projected sprite covers the centre column and its depth is less than the wall distance at that column
    - **Validates: Requirements 8.2**

- [x] 12. Checkpoint — rendering and combat
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Implement `HUD`
  - [x] 13.1 Implement `HUD.update(player)`
    - Set `textContent` of `#health` and `#ammo` DOM elements to current values
    - Toggle `.flash` CSS class on `#crosshair` when `player.muzzleFlash > 0`
    - Toggle `.depleted` CSS class on `#ammo` when `player.ammo === 0`
    - _Requirements: 8.5, 8.7, 9.1, 9.2_

  - [x]* 13.2 Write property test for HUD values reflect player state (Property 18)
    - **Property 18: HUD values reflect player state**
    - For any health `h` in [0, 100] and ammo `a` in [0, 50], after `HUD.update(player)`, the health element's text must equal `h` and the ammo element's text must equal `a`
    - **Validates: Requirements 9.2**

- [x] 14. Implement minimap rendering
  - [x] 14.1 Implement minimap drawing in `Renderer`
    - Draw the map grid onto the minimap canvas: wall cells as a solid colour, floor cells as a darker colour, each cell `CONFIG.MINIMAP_CELL_PX` pixels square
    - Draw the player marker at `(player.x * MINIMAP_CELL_PX, player.y * MINIMAP_CELL_PX)` with a direction indicator
    - Draw each living enemy marker at `(enemy.x * MINIMAP_CELL_PX, enemy.y * MINIMAP_CELL_PX)`
    - Constrain the minimap's rendered pixel width to at most `floor(0.2 * canvasWidth)`
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 14.2 Implement minimap toggle
    - Listen for `M` keypress in `InputHandler` (or directly in the game loop)
    - Toggle a `showMinimap` boolean; pass it to `Renderer.drawFrame`; show/hide the minimap `<div>` accordingly
    - _Requirements: 10.5_

  - [ ]* 14.3 Write property test for minimap entity positions (Property 19)
    - **Property 19: Minimap entity positions are correctly scaled**
    - For any player position `(px, py)` and enemy positions `(ex, ey)`, the player marker must appear at `(px * MINIMAP_CELL_PX, py * MINIMAP_CELL_PX)` and each enemy marker at `(ex * MINIMAP_CELL_PX, ey * MINIMAP_CELL_PX)`
    - **Validates: Requirements 10.2, 10.3**

  - [x]* 14.4 Write property test for minimap size constraint (Property 20)
    - **Property 20: Minimap size does not exceed 20% of canvas width**
    - For any canvas width `W`, the minimap's rendered pixel width must be at most `floor(0.2 * W)`
    - **Validates: Requirements 10.4**

- [x] 15. Implement `StateManager` and game state transitions
  - [x] 15.1 Implement `StateManager`
    - Define states: `'start'`, `'playing'`, `'gameover'`, `'win'`
    - Implement `transition(to)`: update `current`, show/hide the `#overlay` div with appropriate content
    - Implement `update(dt, game)`: delegate to the active state's update function
    - On `'start'` state: show title screen; transition to `'playing'` on mouse click or `Enter`
    - On `'gameover'` state: show "Game Over" screen with restart option
    - On `'win'` state: show "You Win" screen with restart option
    - Restart option must reinitialise game state without a page reload
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [x] 15.2 Wire health-zero → gameover and all-enemies-dead → win transitions
    - In the game loop (or `StateManager.update`), check `player.health <= 0` → `transition('gameover')`
    - Check `EnemyManager.getLiving().length === 0` → `transition('win')`
    - Stop the game loop (cancel `requestAnimationFrame`) when transitioning to `'gameover'` or `'win'`
    - _Requirements: 9.3, 11.3, 11.4_

  - [x]* 15.3 Write unit tests for `StateManager`
    - Test transition to `'gameover'` when player health reaches 0
    - Test transition to `'win'` when all enemies are dead
    - Test that the game loop stops after a terminal transition
    - _Requirements: 9.3, 11.3, 11.4_

- [x] 16. Implement `Game` — wire all subsystems together
  - [x] 16.1 Implement `Game.init()`
    - Instantiate all subsystems: `InputHandler`, `MapLoader`, `Player`, `EnemyManager`, `Raycaster`, `Renderer`, `TextureManager`, `HUD`, `StateManager`
    - Load the map via `MapLoader.load`; catch errors and show an error overlay if validation fails
    - Load all four wall textures via `TextureManager.load`
    - Detect `requestAnimationFrame` availability; show error overlay if absent
    - Set canvas to fill the viewport; attach `resize` event handler that recalculates `canvasWidth`, `canvasHeight`, and camera plane
    - _Requirements: 1.3, 2.1, 2.3, 3.3, 5.3_

  - [x] 16.2 Implement the main game loop
    - Use `requestAnimationFrame` for the loop; compute `deltaTime = (now - lastTime) / 1000`; cap at 0.1 s
    - Call `InputHandler.poll()` (if applicable), `StateManager.update(dt, game)`, `Raycaster.castAll`, `Renderer.drawFrame`, `HUD.update`
    - Pass `showMinimap` flag to `Renderer.drawFrame`
    - _Requirements: 2.2, 2.4, 2.5_

- [x] 17. Add CSS styling and HUD layout
  - Style `#gameCanvas` to fill the viewport (`width: 100vw; height: 100vh`)
  - Position `#hud` as a fixed overlay with `#health`, `#ammo`, and `#crosshair` elements
  - Add `.flash` CSS animation for muzzle flash on `#crosshair`
  - Add `.depleted` CSS style for the ammo indicator
  - Position `#minimap` in a corner of the viewport
  - Style `#overlay` for start/gameover/win screens (centred, semi-transparent background)
  - _Requirements: 9.1, 9.4, 10.1, 11.1_

- [x] 18. Define the game map and enemy placements
  - Define a default map as a `number[][]` literal in `game.js` — at least 16×16, fully enclosed, with wall types 1–4 used
  - Define at least one enemy with a `startX`, `startY`, `health: 100`, and `spriteId`
  - Ensure the player spawn position is on a floor cell and not adjacent to a wall within `PLAYER_RADIUS`
  - _Requirements: 3.1, 3.4, 7.5_

- [x] 19. Final checkpoint — full integration
  - Ensure all tests pass, ask the user if questions arise.
  - Verify the game opens from `file://` without errors (Requirement 1.3)
  - Verify the canvas resizes correctly on window resize (Requirement 2.3)
  - Verify the minimap toggle works with the `M` key (Requirement 10.5)
  - Verify the restart option works without a page reload (Requirement 11.5)

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests (Properties 1–22) are each their own sub-task, placed close to the implementation they validate
- Checkpoints at tasks 5, 12, and 19 ensure incremental validation
- The `tests.html` file is a dev-only artifact and must not be loaded by `index.html`
- fast-check is a dev-only dependency loaded via CDN in `tests.html`; it is not a runtime dependency of the game
