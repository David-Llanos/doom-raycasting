# Requirements Document

## Introduction

A Doom-inspired first-person raycasting game that runs entirely in the browser using plain HTML, CSS, and JavaScript — no frameworks, no build tools, no backend. The game renders a navigable 3D maze from a first-person perspective using the raycasting technique pioneered by Wolfenstein 3D and Doom. It features textured walls, enemy sprites, a shooting mechanic, and a minimap overlay, all rendered on an HTML5 `<canvas>` element.

## Glossary

- **Engine**: The raycasting rendering system responsible for projecting the 3D view onto the canvas.
- **Player**: The user-controlled character navigating the maze.
- **Ray**: A single line cast from the Player's position outward to detect wall intersections.
- **Wall Slice**: A vertical strip of pixels on the canvas representing one column of the 3D view, derived from a single Ray.
- **Texture**: A bitmap image (or procedurally generated pixel array) mapped onto a Wall Slice to give walls visual detail.
- **Sprite**: A billboard image representing an enemy or object, always facing the Player.
- **Enemy**: A non-player character rendered as a Sprite that the Player can shoot.
- **Minimap**: A 2D top-down overlay showing the maze layout, Player position, and Enemy positions.
- **Map**: A 2D grid of cells where each cell is either a wall or an open floor tile.
- **FOV**: Field of View — the horizontal angle (in degrees) of the Player's visible cone.
- **HUD**: Heads-Up Display — the on-screen UI showing health and ammo.
- **Projectile**: The in-game representation of a shot fired by the Player.
- **Game Loop**: The recurring update-and-render cycle driven by `requestAnimationFrame`.
- **Delta Time**: The elapsed time between two consecutive Game Loop frames, used to normalise movement speed.

---

## Requirements

### Requirement 1: Static Delivery

**User Story:** As a player, I want to open the game in any modern browser without installing anything, so that I can play immediately.

#### Acceptance Criteria

1. THE Engine SHALL run entirely within one or more static files (HTML, CSS, JS) that require no server-side processing.
2. THE Engine SHALL not depend on any external JavaScript frameworks, libraries, or CDN-hosted resources at runtime.
3. WHEN a user opens the HTML file directly from the filesystem (`file://` protocol), THE Engine SHALL initialise and reach the start screen without errors.

---

### Requirement 2: Canvas Rendering

**User Story:** As a player, I want a smooth, full-screen 3D view, so that the game feels immersive.

#### Acceptance Criteria

1. THE Engine SHALL render the 3D view onto an HTML5 `<canvas>` element using the 2D Canvas API.
2. THE Engine SHALL drive the Game Loop using `requestAnimationFrame` to synchronise rendering with the display refresh rate.
3. WHEN the browser window is resized, THE Engine SHALL resize the canvas to fill the viewport and recalculate all projection constants within one frame.
4. THE Engine SHALL use Delta Time to scale Player movement and animation so that speed is consistent regardless of frame rate.
5. THE Engine SHALL render at a minimum of 30 frames per second on a mid-range desktop browser (Chrome or Firefox, released within the last three years) when the Map contains no more than 64 × 64 cells.

---

### Requirement 3: Map Definition

**User Story:** As a developer, I want the maze defined as a simple 2D grid, so that levels are easy to author and modify.

#### Acceptance Criteria

1. THE Engine SHALL represent the Map as a 2D array of integer values where `0` denotes a floor cell and any non-zero value denotes a wall cell.
2. THE Engine SHALL support Map dimensions of at least 8 × 8 cells and at most 64 × 64 cells.
3. WHEN the Map is loaded, THE Engine SHALL validate that the Map is fully enclosed (all border cells are walls) and, IF the Map is not fully enclosed, THE Engine SHALL halt initialisation and log a descriptive error to the browser console.
4. THE Engine SHALL assign a distinct wall type to each non-zero integer value, allowing different integers to map to different Textures.

---

### Requirement 4: Raycasting Engine

**User Story:** As a player, I want a convincing first-person 3D perspective, so that navigating the maze feels spatial.

#### Acceptance Criteria

1. WHEN rendering a frame, THE Engine SHALL cast one Ray per horizontal pixel column of the canvas.
2. THE Engine SHALL use a digital differential analyser (DDA) algorithm to find the nearest wall intersection for each Ray.
3. THE Engine SHALL compute the projected Wall Slice height for each Ray using the perpendicular distance to the wall (not the Euclidean distance) to eliminate fisheye distortion.
4. THE Engine SHALL render the ceiling as a solid colour above each Wall Slice and the floor as a solid colour below each Wall Slice.
5. THE Engine SHALL support a configurable FOV between 45° and 120°, defaulting to 66°.
6. WHEN two Wall Slices are at different distances, THE Engine SHALL render the nearer Wall Slice in front of the farther one.

---

### Requirement 5: Wall Textures

**User Story:** As a player, I want textured walls, so that the maze looks visually interesting rather than flat-coloured.

#### Acceptance Criteria

1. THE Engine SHALL map a Texture onto each Wall Slice by sampling the correct horizontal pixel column of the Texture based on the Ray's intersection offset within the wall cell.
2. THE Engine SHALL support Textures stored as inline data URIs or as same-origin image files loadable via the Canvas API.
3. THE Engine SHALL support at least four distinct wall Textures, one per non-zero Map integer value (1–4).
4. WHEN a Texture has not finished loading, THE Engine SHALL render the Wall Slice using a solid fallback colour and SHALL NOT throw an uncaught exception.
5. THE Engine SHALL apply distance-based darkening to Wall Slices so that walls farther from the Player appear darker, simulating depth.

---

### Requirement 6: Player Movement and Collision

**User Story:** As a player, I want responsive movement controls, so that navigating the maze feels natural.

#### Acceptance Criteria

1. THE Engine SHALL move the Player forward when the `W` key or `ArrowUp` key is held, and backward when the `S` key or `ArrowDown` key is held.
2. THE Engine SHALL rotate the Player left when the `A` key or `ArrowLeft` key is held, and right when the `D` key or `ArrowRight` key is held.
3. THE Engine SHALL scale Player movement speed by Delta Time so that movement is frame-rate independent.
4. WHEN the Player's next position would intersect a wall cell, THE Engine SHALL prevent the Player from entering that cell while still allowing sliding movement along the wall.
5. THE Engine SHALL keep the Player's position at least 0.2 map units away from any wall at all times.
6. WHEN the browser window does not have keyboard focus, THE Engine SHALL not process movement input.

---

### Requirement 7: Enemy Sprites

**User Story:** As a player, I want to see enemies in the maze, so that the game has challenge and atmosphere.

#### Acceptance Criteria

1. THE Engine SHALL render each Enemy as a Sprite billboard that always faces the Player regardless of the Player's rotation angle.
2. THE Engine SHALL scale each Sprite's rendered size inversely with its distance from the Player so that nearer Enemies appear larger.
3. THE Engine SHALL sort Sprites by distance from the Player and render them back-to-front so that nearer Sprites occlude farther ones.
4. THE Engine SHALL clip each Sprite's vertical extent to the canvas bounds and SHALL NOT render Sprite pixels that fall behind a closer wall (per-column depth comparison).
5. THE Engine SHALL support at least one Enemy type with a defined starting position on the Map.
6. WHEN an Enemy's health reaches zero, THE Engine SHALL remove the Enemy from the scene and SHALL NOT render it in subsequent frames.

---

### Requirement 8: Shooting Mechanic

**User Story:** As a player, I want to shoot enemies, so that I have a goal and a challenge to overcome.

#### Acceptance Criteria

1. WHEN the player presses the left mouse button or the `Space` key, THE Engine SHALL fire a shot from the Player's current position along the Player's current facing direction.
2. THE Engine SHALL perform a ray-based hit test along the Player's centre screen column to determine whether the shot intersects an Enemy Sprite before hitting a wall.
3. WHEN a shot intersects an Enemy, THE Engine SHALL reduce that Enemy's health by a fixed damage value.
4. THE Engine SHALL enforce a minimum interval of 500 ms between consecutive shots (fire rate limit).
5. THE Engine SHALL display a muzzle-flash visual effect on the HUD for 100 ms after each shot.
6. THE Engine SHALL track the Player's remaining ammo count, starting at 50 rounds, and SHALL NOT fire when ammo reaches zero.
7. WHEN ammo reaches zero, THE Engine SHALL display a visual indicator on the HUD informing the player that ammo is depleted.

---

### Requirement 9: HUD

**User Story:** As a player, I want to see my health and ammo at a glance, so that I can make tactical decisions.

#### Acceptance Criteria

1. THE Engine SHALL render the HUD as an overlay on top of the canvas, displaying the Player's current health (0–100) and current ammo count.
2. THE Engine SHALL update the HUD values every frame to reflect the current game state.
3. WHEN the Player's health reaches zero, THE Engine SHALL display a "Game Over" screen and SHALL stop the Game Loop.
4. THE Engine SHALL render the HUD using HTML elements positioned over the canvas via CSS, rather than drawing HUD text directly onto the canvas.

---

### Requirement 10: Minimap Overlay

**User Story:** As a player, I want a minimap, so that I can orient myself within the maze.

#### Acceptance Criteria

1. THE Engine SHALL render a Minimap in a corner of the viewport showing the full Map grid as a top-down 2D view.
2. THE Engine SHALL draw the Player's current position and facing direction on the Minimap as a distinct marker.
3. THE Engine SHALL draw each living Enemy's position on the Minimap as a distinct marker.
4. THE Engine SHALL render the Minimap at a fixed pixel size that does not obscure more than 20% of the canvas width.
5. WHEN the player presses the `M` key, THE Engine SHALL toggle the Minimap visibility between shown and hidden.

---

### Requirement 11: Game State Management

**User Story:** As a player, I want clear start and end states, so that I know when the game begins and when it is over.

#### Acceptance Criteria

1. WHEN the page loads, THE Engine SHALL display a start screen with the game title and a prompt to begin.
2. WHEN the player activates the start prompt (mouse click or `Enter` key), THE Engine SHALL initialise the game state and begin the Game Loop.
3. WHEN all Enemies are defeated, THE Engine SHALL display a "You Win" screen and SHALL stop the Game Loop.
4. WHEN the Player's health reaches zero, THE Engine SHALL display a "Game Over" screen and SHALL stop the Game Loop.
5. WHEN a "Game Over" or "You Win" screen is displayed, THE Engine SHALL offer a restart option that reinitialises the game state and restarts the Game Loop without requiring a page reload.

---

### Requirement 12: Enemy Damage

**User Story:** As a player, I want enemies to be able to hurt me, so that the game presents a real challenge.

#### Acceptance Criteria

1. WHEN the Player is within 1.5 map units of an Enemy, THE Engine SHALL reduce the Player's health by a fixed damage value at a rate of once per second.
2. THE Engine SHALL apply damage independently for each Enemy within range, so that multiple nearby Enemies deal cumulative damage.
3. WHEN the Player moves out of range of all Enemies, THE Engine SHALL stop applying proximity damage.
4. THE Engine SHALL clamp the Player's health to a minimum of 0 and a maximum of 100 at all times.
