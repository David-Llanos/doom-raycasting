/**
 * Doom Raycaster - game.js
 * Single JavaScript entry point. No build step, no external runtime dependencies.
 * Works on file:// protocol.
 */

'use strict';

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------
// This object is the safest first place to tune the game. Speeds are measured
// in map units per second, angles are radians unless the name says FOV, and
// timings are seconds. Map units line up with cells in DEFAULT_MAP below.
const CONFIG = {
  // Horizontal field of view in degrees. Wider values feel faster but can
  // distort the edges; the requirements allow 45-120 and default to 66.
  FOV:              66,
  // Player walking speed, in map cells per second.
  MOVE_SPEED:       3.0,
  // Player turn speed, in radians per second.
  ROT_SPEED:        2.5,
  // Minimum wall clearance. Raising this makes the player feel "larger".
  PLAYER_RADIUS:    0.2,
  // Damage per second from each enemy inside ENEMY_RANGE.
  ENEMY_DAMAGE:     10,
  // Distance, in map cells, at which enemies start damaging the player.
  ENEMY_RANGE:      1.5,
  // Damage per successful shot. Current value kills a 100 HP enemy in 3 hits.
  SHOT_DAMAGE:      34,
  // Seconds between shots.
  FIRE_RATE:        0.5,
  // Seconds the crosshair muzzle-flash class remains active after firing.
  MUZZLE_FLASH_DUR: 0.1,
  STARTING_HEALTH:  100,
  STARTING_AMMO:    50,
  // Procedural textures are square and sampled as TEXTURE_SIZE x TEXTURE_SIZE.
  TEXTURE_SIZE:     64,
  // Base minimap cell size before it is scaled down to fit the viewport.
  MINIMAP_CELL_PX:  6,
  // Larger values keep distant walls brighter; smaller values darken sooner.
  DARKEN_FACTOR:    5.0,
};

// Clamp is used anywhere game state must stay in a valid range, such as health
// and render darkening. It avoids repeated Math.max(Math.min(...)) blocks.
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Raycasting represents the camera as a forward vector plus a perpendicular
// "camera plane". The plane length is tan(FOV / 2), so changing FOV changes how
// far left/right rays spread from the player's forward direction.
function fovToPlaneLength(fov) {
  return Math.tan((fov * Math.PI / 180) / 2);
}

// Recompute forward direction and camera plane from the player's angle. Call
// this after changing player.angle or if you add runtime FOV changes later.
function updatePlayerVectors(player, fov = CONFIG.FOV) {
  const planeLength = fovToPlaneLength(fov);
  player.dirX = Math.cos(player.angle);
  player.dirY = Math.sin(player.angle);
  player.planeX = -player.dirY * planeLength;
  player.planeY = player.dirX * planeLength;
}

const InputHandler = {
  // _keys stores the current held/released state by KeyboardEvent.code, e.g.
  // "KeyW", "ArrowLeft", "Space". This is layout-independent.
  _keys: {},
  // Mouse clicks are edge-triggered: the flag is set by mousedown and consumed
  // once by wasClicked(). That prevents one click from firing every frame.
  _mouseClicked: false,
  // M is also edge-triggered so holding M does not rapidly flicker the minimap.
  _minimapToggled: false,
  _inited: false,

  init() {
    // Tests load this file too; _inited prevents duplicate listeners.
    if (this._inited || typeof window === 'undefined') return;
    this._inited = true;

    window.addEventListener('keydown', (e) => {
      this._keys[e.code] = true;
      if (e.code === 'KeyM' && !e.repeat) this._minimapToggled = true;
    });
    window.addEventListener('keyup', (e) => {
      this._keys[e.code] = false;
    });
    window.addEventListener('mousedown', () => {
      this._mouseClicked = true;
    });
    window.addEventListener('blur', () => {
      this._keys = {};
    });
  },

  reset() {
    this._keys = {};
    this._mouseClicked = false;
    this._minimapToggled = false;
  },

  isHeld(code) {
    return !!this._keys[code];
  },

  wasClicked() {
    const clicked = this._mouseClicked;
    this._mouseClicked = false;
    return clicked;
  },

  wasMinimapToggled() {
    const toggled = this._minimapToggled;
    this._minimapToggled = false;
    return toggled;
  },

  hasFocus() {
    return typeof document === 'undefined' ? true : document.hasFocus();
  },
};

const MapLoader = {
  load(grid) {
    // Maps are rectangular 2D arrays. 0 is floor; any non-zero integer is a
    // wall type and maps to a texture id with the same string value.
    if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0])) {
      throw new Error('Map must be a non-empty 2D array');
    }

    const height = grid.length;
    const width = grid[0].length;

    if (width < 8 || width > 64) {
      throw new Error(`Map width must be between 8 and 64, got ${width}`);
    }
    if (height < 8 || height > 64) {
      throw new Error(`Map height must be between 8 and 64, got ${height}`);
    }

    for (let row = 0; row < height; row++) {
      // Rectangular rows matter because raycasting indexes map.cells[y][x].
      if (!Array.isArray(grid[row]) || grid[row].length !== width) {
        throw new Error(`Map row ${row} must have width ${width}`);
      }
    }

    // The DDA ray loop assumes rays eventually hit a wall. A fully enclosed map
    // guarantees that, so invalid maps fail at startup instead of during play.
    for (let col = 0; col < width; col++) {
      if (grid[0][col] === 0) {
        throw new Error(`Map is not fully enclosed: border cell at row 0, col ${col} is open`);
      }
      if (grid[height - 1][col] === 0) {
        throw new Error(`Map is not fully enclosed: border cell at row ${height - 1}, col ${col} is open`);
      }
    }
    for (let row = 1; row < height - 1; row++) {
      if (grid[row][0] === 0) {
        throw new Error(`Map is not fully enclosed: border cell at row ${row}, col 0 is open`);
      }
      if (grid[row][width - 1] === 0) {
        throw new Error(`Map is not fully enclosed: border cell at row ${row}, col ${width - 1} is open`);
      }
    }

    return { cells: grid, width, height };
  },
};

function createPlayer(x, y) {
  // The player stores both angle and derived direction vectors. Angle is the
  // source of truth; dir/plane are cached so movement/rendering can use them.
  const player = {
    x,
    y,
    angle: 0,
    dirX: 1,
    dirY: 0,
    planeX: 0,
    planeY: fovToPlaneLength(CONFIG.FOV),
    health: CONFIG.STARTING_HEALTH,
    ammo: CONFIG.STARTING_AMMO,
    fireCooldown: 0,
    muzzleFlash: 0,

    takeDamage(amount) {
      // Negative damage acts like healing, but health still cannot exceed 100.
      this.health = clamp(this.health - amount, 0, 100);
    },

    shoot() {
      // Shooting is intentionally stateful: ammo and cooldown are consumed here
      // so the game loop can simply ask "did a shot happen?".
      if (this.ammo === 0 || this.fireCooldown > 0) return false;
      this.ammo -= 1;
      this.fireCooldown = CONFIG.FIRE_RATE;
      this.muzzleFlash = CONFIG.MUZZLE_FLASH_DUR;
      return true;
    },

    update(dt, input, map) {
      // Timers tick even if the window loses focus. Movement does not.
      this.fireCooldown = Math.max(0, this.fireCooldown - dt);
      this.muzzleFlash = Math.max(0, this.muzzleFlash - dt);
      if (!input.hasFocus()) return;

      const rotSpeed = CONFIG.ROT_SPEED * dt;
      if (input.isHeld('KeyA') || input.isHeld('ArrowLeft')) this.angle -= rotSpeed;
      if (input.isHeld('KeyD') || input.isHeld('ArrowRight')) this.angle += rotSpeed;
      updatePlayerVectors(this);

      const moveSpeed = CONFIG.MOVE_SPEED * dt;
      let moveX = 0;
      let moveY = 0;
      // Movement is relative to the direction vector. To add strafing later,
      // use the camera plane vector here for left/right translation.
      if (input.isHeld('KeyW') || input.isHeld('ArrowUp')) {
        moveX += this.dirX * moveSpeed;
        moveY += this.dirY * moveSpeed;
      }
      if (input.isHeld('KeyS') || input.isHeld('ArrowDown')) {
        moveX -= this.dirX * moveSpeed;
        moveY -= this.dirY * moveSpeed;
      }

      if (moveX !== 0) {
        // Collision is resolved one axis at a time. This is what lets the
        // player slide along a wall instead of stopping on diagonal movement.
        const newX = this.x + moveX;
        // Probe ahead by PLAYER_RADIUS so the player center never gets closer
        // than that radius to a wall face.
        const probeX = Math.floor(newX + Math.sign(moveX) * CONFIG.PLAYER_RADIUS);
        if (map.cells[Math.floor(this.y)]?.[probeX] === 0) this.x = newX;
      }
      if (moveY !== 0) {
        const newY = this.y + moveY;
        const probeY = Math.floor(newY + Math.sign(moveY) * CONFIG.PLAYER_RADIUS);
        if (map.cells[probeY]?.[Math.floor(this.x)] === 0) this.y = newY;
      }
    },
  };
  updatePlayerVectors(player);
  return player;
}

const TextureManager = {
  // Stored shape: { [id]: { img, imageData } }. imageData is the fast sampled
  // copy; img is kept mostly for diagnostics or future drawImage use.
  _textures: {},

  load(id, src) {
    const img = document.createElement('img');
    this._textures[id] = { img, imageData: null };

    const promise = new Promise((resolve, reject) => {
      img.onload = () => {
        // Draw once to an offscreen canvas so Renderer can read exact pixels
        // with sample() instead of asking Canvas to scale per wall column.
        const canvas = document.createElement('canvas');
        canvas.width = CONFIG.TEXTURE_SIZE;
        canvas.height = CONFIG.TEXTURE_SIZE;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, CONFIG.TEXTURE_SIZE, CONFIG.TEXTURE_SIZE);
        this._textures[id].imageData = ctx.getImageData(0, 0, CONFIG.TEXTURE_SIZE, CONFIG.TEXTURE_SIZE);
        resolve(img);
      };
      img.onerror = reject;
    });

    img.src = src;
    return promise;
  },

  get(id) {
    return this._textures[id]?.img ?? null;
  },

  sample(id, u, v) {
    const entry = this._textures[id];
    // Bright magenta is a classic missing-texture color and makes failures
    // obvious without throwing during rendering.
    if (!entry || !entry.imageData) return [255, 0, 255, 255];

    // u and v are normalized coordinates in [0, 1]. Clamp protects against
    // rounding at exactly 1.0 and any future caller mistakes.
    const texX = clamp(Math.floor(u * CONFIG.TEXTURE_SIZE), 0, CONFIG.TEXTURE_SIZE - 1);
    const texY = clamp(Math.floor(v * CONFIG.TEXTURE_SIZE), 0, CONFIG.TEXTURE_SIZE - 1);
    const idx = (texY * CONFIG.TEXTURE_SIZE + texX) * 4;
    const data = entry.imageData.data;
    return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
  },
};

const Raycaster = {
  castAll(player, map, canvasWidth, fov = CONFIG.FOV) {
    // One ray per horizontal screen column. The Renderer later turns each ray
    // result into one vertical textured wall slice.
    const rays = [];
    const planeLength = fovToPlaneLength(fov);
    const dirX = Math.cos(player.angle);
    const dirY = Math.sin(player.angle);
    const planeX = -dirY * planeLength;
    const planeY = dirX * planeLength;

    for (let x = 0; x < canvasWidth; x++) {
      // cameraX maps the column range to [-1, +1]. -1 is the far left edge of
      // the camera plane, 0 is straight ahead, +1 is the far right edge.
      const cameraX = 2 * x / canvasWidth - 1;
      const rayDirX = dirX + planeX * cameraX;
      const rayDirY = dirY + planeY * cameraX;
      rays.push(this.castSingle(player, map, rayDirX, rayDirY));
    }
    return rays;
  },

  castSingle(player, map, rayDirX, rayDirY) {
    // DDA starts in the player's current map cell and steps from grid boundary
    // to grid boundary until it enters a wall cell.
    let mapX = Math.floor(player.x);
    let mapY = Math.floor(player.y);
    // deltaDist is how far along the ray you must travel to cross one cell in
    // X or Y. Infinity handles perfectly vertical/horizontal rays safely.
    const deltaDistX = rayDirX === 0 ? Infinity : Math.abs(1 / rayDirX);
    const deltaDistY = rayDirY === 0 ? Infinity : Math.abs(1 / rayDirY);
    let sideDistX;
    let sideDistY;
    let stepX;
    let stepY;
    let side = 0;

    if (rayDirX < 0) {
      // Step left; first X boundary is at mapX.
      stepX = -1;
      sideDistX = (player.x - mapX) * deltaDistX;
    } else {
      // Step right; first X boundary is at mapX + 1.
      stepX = 1;
      sideDistX = (mapX + 1 - player.x) * deltaDistX;
    }

    if (rayDirY < 0) {
      stepY = -1;
      sideDistY = (player.y - mapY) * deltaDistY;
    } else {
      stepY = 1;
      sideDistY = (mapY + 1 - player.y) * deltaDistY;
    }

    let wallType = 0;
    let guard = 0;
    while (guard++ < map.width * map.height * 2) {
      // Step along whichever grid boundary is closer. side=0 means the ray hit
      // a vertical wall face; side=1 means it hit a horizontal wall face.
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX;
        mapX += stepX;
        side = 0;
      } else {
        sideDistY += deltaDistY;
        mapY += stepY;
        side = 1;
      }

      wallType = map.cells[mapY]?.[mapX] ?? 1;
      if (wallType !== 0) break;
    }

    // sideDist has already been advanced one step past the hit boundary, so
    // subtract deltaDist to get the perpendicular wall distance. This avoids
    // fisheye distortion; do not replace with Euclidean distance.
    let distance = side === 0 ? sideDistX - deltaDistX : sideDistY - deltaDistY;
    distance = Math.max(distance, 0.0001);

    // wallX is the fractional hit position along the wall face. Renderer uses
    // this as the horizontal texture coordinate.
    let wallX = side === 0
      ? player.y + distance * rayDirY
      : player.x + distance * rayDirX;
    wallX -= Math.floor(wallX);

    return { distance, wallX, side, mapX, mapY, wallType, rayDirX, rayDirY };
  },

  projectedHeight(canvasHeight, distance) {
    return Math.floor(canvasHeight / Math.max(distance, 0.0001));
  },
};

function createEnemy(def) {
  // Enemy definitions use startX/startY in DEFAULT_ENEMIES, but x/y are also
  // accepted so tests or future spawned enemies can use a simpler shape.
  return {
    id: def.id,
    x: def.startX ?? def.x,
    y: def.startY ?? def.y,
    health: def.health ?? 100,
    spriteId: def.spriteId ?? 'enemy',
    alive: (def.health ?? 100) > 0,
    distance: 0,
    screenX: 0,

    takeDamage(amount) {
      this.health = Math.max(0, this.health - amount);
      if (this.health <= 0) this.alive = false;
    },
  };
}

function createEnemyManager(definitions) {
  return {
    enemies: definitions.map(createEnemy),

    update(dt, player) {
      // Enemies are stationary in this MVP. To add chasing AI later, this is
      // the place to move each enemy before computing distance/damage.
      for (const enemy of this.enemies) {
        if (!enemy.alive || enemy.health <= 0) {
          enemy.alive = false;
          continue;
        }
        const dx = enemy.x - player.x;
        const dy = enemy.y - player.y;
        enemy.distance = Math.hypot(dx, dy);
        if (enemy.distance <= CONFIG.ENEMY_RANGE) {
          // Damage scales with dt, so frame rate does not affect difficulty.
          player.takeDamage(CONFIG.ENEMY_DAMAGE * dt);
        }
      }
    },

    getLiving() {
      return this.enemies.filter((enemy) => enemy.alive && enemy.health > 0);
    },

    hitTest(ray) {
      // Shooting uses the center screen ray. Each living enemy already has
      // projection data from Renderer/Game; the closest enemy covering the
      // center column and in front of the wall is selected.
      let best = null;
      let bestDepth = Infinity;
      for (const enemy of this.getLiving()) {
        const depth = enemy.transformY ?? enemy.distance;
        const width = enemy.spriteWidth ?? Math.max(1, Math.floor(64 / Math.max(depth || 1, 0.0001)));
        const screenX = enemy.screenX ?? 0;
        const coversCenter = Math.abs(screenX - (ray.screenX ?? screenX)) <= width / 2 || enemy.coversCenter === true;
        if (coversCenter && depth < ray.distance && depth < bestDepth) {
          best = enemy;
          bestDepth = depth;
        }
      }
      return best;
    },
  };
}

const Renderer = {
  // zBuffer[x] stores the wall distance for screen column x. Sprite rendering
  // consults it so enemies behind walls are not drawn over those walls.
  zBuffer: new Float32Array(0),

  darkening(distance) {
    // Depth cue: nearby surfaces stay bright; far surfaces approach 10%.
    return clamp(1 - distance / CONFIG.DARKEN_FACTOR, 0.1, 1.0);
  },

  projectEnemy(enemy, player, canvasWidth, canvasHeight) {
    // Convert world-space enemy position into camera space. transformY is
    // depth in front of the camera; transformX is horizontal offset.
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const invDet = 1 / (player.planeX * player.dirY - player.dirX * player.planeY);
    const transformX = invDet * (player.dirY * dx - player.dirX * dy);
    const transformY = invDet * (-player.planeY * dx + player.planeX * dy);
    // Negative/zero depth means the enemy is behind the player or on the
    // camera plane, so it should not be projected.
    if (transformY <= 0) return null;

    // Billboard sprites are square and shrink as transformY grows.
    const screenX = Math.floor((canvasWidth / 2) * (1 + transformX / transformY));
    const spriteHeight = Math.abs(Math.floor(canvasHeight / transformY));
    const spriteWidth = spriteHeight;
    return { enemy, transformX, transformY, screenX, spriteHeight, spriteWidth };
  },

  getProjectedEnemies(enemies, player, canvasWidth, canvasHeight) {
    return enemies
      .map((enemy) => this.projectEnemy(enemy, player, canvasWidth, canvasHeight))
      .filter(Boolean)
      // Draw farthest to nearest so nearer sprites can overwrite farther ones.
      .sort((a, b) => b.transformY - a.transformY);
  },

  drawFrame({ ctx, rayResults, enemies, player, map, textures, showMinimap, minimapCanvas }) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;

    // Ceiling and floor are cheap full-canvas fills. Wall pixels are drawn
    // afterward only where the vertical slices are visible.
    ctx.fillStyle = '#2f3343';
    ctx.fillRect(0, 0, width, Math.floor(height / 2));
    ctx.fillStyle = '#252019';
    ctx.fillRect(0, Math.floor(height / 2), width, Math.ceil(height / 2));

    const image = ctx.createImageData(width, height);
    this.zBuffer = new Float32Array(width);

    // Build all wall columns into one ImageData buffer and flush once. This is
    // much faster than issuing a draw call for each column.
    for (let x = 0; x < rayResults.length; x++) {
      const ray = rayResults[x];
      // Projection formula: nearby walls get taller; far walls get shorter.
      const sliceHeight = Raycaster.projectedHeight(height, ray.distance);
      const drawStart = Math.max(0, Math.floor(height / 2 - sliceHeight / 2));
      const drawEnd = Math.min(height - 1, Math.floor(height / 2 + sliceHeight / 2));
      const shade = this.darkening(ray.distance);
      this.zBuffer[x] = ray.distance;

      for (let y = drawStart; y <= drawEnd; y++) {
        // Convert the current screen row inside this wall slice into vertical
        // texture coordinate [0,1].
        const texY = (y - (height / 2 - sliceHeight / 2)) / sliceHeight;
        const pixel = textures.sample(String(ray.wallType), ray.wallX, texY);
        const idx = (y * width + x) * 4;
        image.data[idx] = Math.floor(pixel[0] * shade);
        image.data[idx + 1] = Math.floor(pixel[1] * shade);
        image.data[idx + 2] = Math.floor(pixel[2] * shade);
        image.data[idx + 3] = pixel[3];
      }
    }

    ctx.putImageData(image, 0, 0);
    this.drawSprites(ctx, enemies, player, textures);
    this.drawMinimap(minimapCanvas, map, player, enemies, showMinimap, width);
  },

  drawSprites(ctx, enemies, player, textures) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const projected = this.getProjectedEnemies(enemies, player, width, height);

    for (const sprite of projected) {
      const enemy = sprite.enemy;
      // Cache projection data on the enemy so shooting hit tests can reuse the
      // same screen-space values.
      enemy.distance = sprite.transformY;
      enemy.transformY = sprite.transformY;
      enemy.screenX = sprite.screenX;
      enemy.spriteWidth = sprite.spriteWidth;

      const drawStartY = Math.max(0, Math.floor(height / 2 - sprite.spriteHeight / 2));
      const drawEndY = Math.min(height - 1, Math.floor(height / 2 + sprite.spriteHeight / 2));
      const drawStartX = Math.max(0, Math.floor(sprite.screenX - sprite.spriteWidth / 2));
      const drawEndX = Math.min(width - 1, Math.floor(sprite.screenX + sprite.spriteWidth / 2));
      const shade = this.darkening(sprite.transformY);
      const image = ctx.getImageData(drawStartX, drawStartY, Math.max(1, drawEndX - drawStartX + 1), Math.max(1, drawEndY - drawStartY + 1));

      for (let stripe = drawStartX; stripe <= drawEndX; stripe++) {
        // Per-column depth test: draw this sprite column only if it is closer
        // than the wall already rendered in the same column.
        if (sprite.transformY >= this.zBuffer[stripe]) continue;
        const texX = (stripe - (sprite.screenX - sprite.spriteWidth / 2)) / sprite.spriteWidth;
        for (let y = drawStartY; y <= drawEndY; y++) {
          const texY = (y - (height / 2 - sprite.spriteHeight / 2)) / sprite.spriteHeight;
          const pixel = textures.sample(enemy.spriteId, texX, texY);
          // Transparent pixels and missing-texture magenta pixels are skipped,
          // which makes the sprite shape non-rectangular.
          if (pixel[3] < 16 || (pixel[0] === 255 && pixel[1] === 0 && pixel[2] === 255)) continue;
          const localX = stripe - drawStartX;
          const localY = y - drawStartY;
          const idx = (localY * image.width + localX) * 4;
          image.data[idx] = Math.floor(pixel[0] * shade);
          image.data[idx + 1] = Math.floor(pixel[1] * shade);
          image.data[idx + 2] = Math.floor(pixel[2] * shade);
          image.data[idx + 3] = pixel[3];
        }
      }
      ctx.putImageData(image, drawStartX, drawStartY);
    }
  },

  minimapSize(map, canvasWidth) {
    // Keep the minimap from covering too much of the 3D view.
    const natural = map.width * CONFIG.MINIMAP_CELL_PX;
    return Math.min(natural, Math.floor(canvasWidth * 0.2));
  },

  drawMinimap(canvas, map, player, enemies, showMinimap, canvasWidth) {
    if (!canvas) return;
    canvas.parentElement.style.display = showMinimap ? 'block' : 'none';
    if (!showMinimap) return;

    const size = this.minimapSize(map, canvasWidth);
    // The minimap is drawn at the configured cell size, then uniformly scaled
    // down if needed to satisfy the 20% viewport-width constraint.
    const scale = size / (map.width * CONFIG.MINIMAP_CELL_PX);
    canvas.width = size;
    canvas.height = Math.floor(map.height * CONFIG.MINIMAP_CELL_PX * scale);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        ctx.fillStyle = map.cells[y][x] ? '#9a8f7a' : '#151515';
        ctx.fillRect(x * CONFIG.MINIMAP_CELL_PX * scale, y * CONFIG.MINIMAP_CELL_PX * scale, CONFIG.MINIMAP_CELL_PX * scale, CONFIG.MINIMAP_CELL_PX * scale);
      }
    }

    ctx.fillStyle = '#e33';
    for (const enemy of enemies.filter((e) => e.alive)) {
      ctx.beginPath();
      ctx.arc(enemy.x * CONFIG.MINIMAP_CELL_PX * scale, enemy.y * CONFIG.MINIMAP_CELL_PX * scale, Math.max(2, 2.5 * scale), 0, Math.PI * 2);
      ctx.fill();
    }

    const px = player.x * CONFIG.MINIMAP_CELL_PX * scale;
    const py = player.y * CONFIG.MINIMAP_CELL_PX * scale;
    ctx.fillStyle = '#5af';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, 3 * scale), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5af';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + player.dirX * 12 * scale, py + player.dirY * 12 * scale);
    ctx.stroke();
  },
};

const HUD = {
  update(player) {
    // HUD is DOM-based rather than canvas-based, which keeps UI text readable
    // and easy to restyle in index.html.
    const health = document.getElementById('health');
    const ammo = document.getElementById('ammo');
    const crosshair = document.getElementById('crosshair');
    if (health) health.textContent = `HEALTH ${Math.ceil(player.health)}`;
    if (ammo) {
      ammo.textContent = `AMMO ${player.ammo}`;
      ammo.classList.toggle('depleted', player.ammo === 0);
    }
    if (crosshair) crosshair.classList.toggle('flash', player.muzzleFlash > 0);
  },
};

const StateManager = {
  current: 'start',
  _game: null,

  transition(to, game = this._game) {
    // All overlay screens are generated here. If you want different start,
    // death, or win copy/buttons, this is the central place to edit it.
    this.current = to;
    this._game = game;
    const overlay = document.getElementById('overlay');
    if (!overlay) return;

    overlay.style.display = to === 'playing' ? 'none' : 'flex';
    const titles = {
      start: 'Doom Raycaster',
      gameover: 'Game Over',
      win: 'You Win',
      error: 'Error',
    };
    const messages = {
      start: 'Navigate the maze and eliminate all enemies.',
      gameover: 'You were overrun.',
      win: 'All enemies defeated.',
      error: game?.errorMessage ?? 'Unable to initialise the game.',
    };
    const buttonText = to === 'start' ? 'Start Game' : 'Restart';
    overlay.innerHTML = `
      <h1>${titles[to] ?? to}</h1>
      <p>${messages[to] ?? ''}</p>
      ${to === 'start' ? '<p>WASD / Arrow Keys to move | Mouse click or Space to shoot | M to toggle minimap</p>' : ''}
      <button id="startBtn">${buttonText}</button>
    `;
    const button = document.getElementById('startBtn');
    if (button && game) button.addEventListener('click', () => game.start());
  },

  update(dt, game) {
    this._game = game;
    if (this.current === 'start') {
      // Start can be triggered with either mouse click or Enter.
      if (game.input.wasClicked() || game.input.isHeld('Enter')) game.start();
      return;
    }
    if (this.current !== 'playing') return;

    game.player.update(dt, game.input, game.map);
    game.enemyManager.update(dt, game.player);

    // Frame-level input actions live here so they are checked once per update.
    if (game.input.wasMinimapToggled()) game.showMinimap = !game.showMinimap;
    if (game.input.wasClicked() || game.input.isHeld('Space')) game.tryShoot();

    if (game.player.health <= 0) game.stopWithState('gameover');
    if (game.enemyManager.getLiving().length === 0) game.stopWithState('win');
  },
};

// ---------------------------------------------------------------------------
// LEVEL DATA
// ---------------------------------------------------------------------------
// Edit DEFAULT_MAP to change the maze.
//   0 = floor / empty space
//   1..4 = wall types, mapped to texture ids "1".."4" in Game.loadTextures()
// Keep the outer border non-zero or MapLoader will reject the map at startup.
const DEFAULT_MAP = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2],
  [1,0,0,0,0,0,0,0,0,0,2,0,0,0,0,2],
  [1,0,0,3,3,0,0,0,0,0,2,0,0,4,0,2],
  [1,0,0,0,3,0,0,0,1,1,1,0,0,4,0,2],
  [1,0,0,0,3,0,0,0,0,0,0,0,0,4,0,2],
  [1,0,0,0,0,0,2,0,0,0,0,0,0,0,0,2],
  [1,0,1,1,1,0,2,0,0,3,3,3,0,0,0,2],
  [1,0,0,0,0,0,2,0,0,0,0,3,0,0,0,2],
  [1,0,0,0,4,0,0,0,0,0,0,3,0,0,0,2],
  [1,0,0,0,4,0,0,1,1,0,0,0,0,2,0,2],
  [1,0,0,0,4,0,0,0,0,0,0,0,0,2,0,2],
  [1,0,3,0,0,0,0,0,2,0,0,4,4,4,0,2],
  [1,0,3,0,0,0,0,0,2,0,0,0,0,0,0,2],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

// Enemy positions are in map coordinates. Use .5 positions to place entities
// near the center of cells. spriteId must match a loaded texture id.
const DEFAULT_ENEMIES = [
  { id: 1, startX: 8.5, startY: 5.5, health: 100, spriteId: 'enemy' },
  { id: 2, startX: 12.5, startY: 10.5, health: 100, spriteId: 'enemy' },
  { id: 3, startX: 4.5, startY: 12.5, health: 100, spriteId: 'enemy' },
];

function makeTextureDataUri(a, b, accent) {
  // The game has no external runtime assets. These helpers generate small
  // canvas textures and turn them into data URIs that TextureManager can load
  // through the same path as real image files.
  const canvas = document.createElement('canvas');
  canvas.width = CONFIG.TEXTURE_SIZE;
  canvas.height = CONFIG.TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = b;
  for (let y = 0; y < 8; y++) {
    for (let x = (y % 2) * 8; x < 64; x += 16) {
      ctx.fillRect(x, y * 8, 8, 8);
    }
  }
  ctx.strokeStyle = accent;
  for (let i = 0; i <= 64; i += 8) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(64, i);
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 64);
    ctx.stroke();
  }
  return canvas.toDataURL();
}

function makeEnemyDataUri() {
  // Transparent background with a simple enemy face/body. Replace this with a
  // real sprite data URI or same-origin image file if you want custom art.
  const canvas = document.createElement('canvas');
  canvas.width = CONFIG.TEXTURE_SIZE;
  canvas.height = CONFIG.TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = '#711';
  ctx.beginPath();
  ctx.arc(32, 25, 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#b22';
  ctx.fillRect(18, 34, 28, 24);
  ctx.fillStyle = '#ffcf57';
  ctx.fillRect(23, 21, 8, 5);
  ctx.fillRect(36, 21, 8, 5);
  ctx.fillStyle = '#2b0808';
  ctx.fillRect(24, 40, 16, 5);
  return canvas.toDataURL();
}

const Game = {
  // Game is the composition root: it owns real DOM/canvas objects and wires
  // together the otherwise small subsystems above.
  canvas: null,
  ctx: null,
  minimapCanvas: null,
  map: null,
  player: null,
  enemyManager: null,
  input: InputHandler,
  textures: TextureManager,
  state: StateManager,
  showMinimap: true,
  rafId: null,
  lastTime: 0,
  errorMessage: '',

  init() {
    // The runtime has no build step or framework; init performs all startup
    // wiring after DOMContentLoaded.
    if (!window.requestAnimationFrame) {
      this.errorMessage = 'requestAnimationFrame is not available in this browser.';
      this.state.transition('error', this);
      return;
    }

    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.minimapCanvas = document.getElementById('minimapCanvas');
    this.input.init();
    window.addEventListener('resize', () => this.resize());
    this.resize();

    try {
      // Validate the map once at startup so the raycaster can assume enclosed,
      // rectangular map data during the hot render loop.
      this.map = MapLoader.load(DEFAULT_MAP);
    } catch (err) {
      console.error(err);
      this.errorMessage = err.message;
      this.state.transition('error', this);
      return;
    }

    this.loadTextures();
    this.resetWorld();
    this.state.transition('start', this);
    this.loop = this.loop.bind(this);
    this.rafId = requestAnimationFrame(this.loop);
  },

  loadTextures() {
    // To add a new wall type, add a non-zero map integer and a matching string
    // id here. Example: map cell value 5 needs texture id "5".
    const entries = [
      ['1', makeTextureDataUri('#53443f', '#725750', '#291d1b')],
      ['2', makeTextureDataUri('#455057', '#65717a', '#1b2428')],
      ['3', makeTextureDataUri('#4a5439', '#6b7d4e', '#1d2518')],
      ['4', makeTextureDataUri('#5a4530', '#80633d', '#261b10')],
      ['enemy', makeEnemyDataUri()],
    ];
    for (const [id, src] of entries) {
      this.textures.load(id, src).catch((err) => console.warn(`Texture ${id} failed to load`, err));
    }
  },

  resize() {
    if (!this.canvas) return;
    // Canvas backing size must match viewport pixels. CSS width/height alone
    // would stretch the bitmap and make ray columns blurry.
    this.canvas.width = Math.max(1, window.innerWidth);
    this.canvas.height = Math.max(1, window.innerHeight);
  },

  resetWorld() {
    // Restarting does not reload the page; it rebuilds mutable world state from
    // the static level/enemy definitions.
    this.player = createPlayer(2.5, 2.5);
    this.enemyManager = createEnemyManager(DEFAULT_ENEMIES);
    this.showMinimap = true;
    this.input.reset();
    HUD.update(this.player);
  },

  start() {
    // Starting from any overlay creates a fresh run.
    this.resetWorld();
    this.state.transition('playing', this);
    this.lastTime = performance.now();
    if (this.rafId === null) this.rafId = requestAnimationFrame(this.loop);
  },

  stopWithState(state) {
    // Terminal states stop the RAF loop. Restarting schedules it again.
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.state.transition(state, this);
  },

  tryShoot() {
    const fired = this.player.shoot();
    if (!fired) return false;

    // Shooting is hitscan: cast/use the center-column ray immediately and test
    // projected enemy sprites against that column before the wall distance.
    const center = Math.floor(this.canvas.width / 2);
    const ray = Raycaster.castAll(this.player, this.map, this.canvas.width, CONFIG.FOV)[center];
    ray.screenX = center;
    this.updateEnemyProjection();
    const hit = this.enemyManager.hitTest(ray);
    if (hit) hit.takeDamage(CONFIG.SHOT_DAMAGE);
    return true;
  },

  updateEnemyProjection() {
    // Ensure hitTest has current screen-space enemy data even if the player
    // shoots before the next drawSprites pass updates enemy fields.
    const projected = Renderer.getProjectedEnemies(this.enemyManager.getLiving(), this.player, this.canvas.width, this.canvas.height);
    for (const sprite of projected) {
      sprite.enemy.transformY = sprite.transformY;
      sprite.enemy.screenX = sprite.screenX;
      sprite.enemy.spriteWidth = sprite.spriteWidth;
      sprite.enemy.distance = sprite.transformY;
    }
  },

  loop(now) {
    // Cap dt at 0.1s so tab switches/debugger pauses do not cause huge movement
    // or damage jumps when the frame loop resumes.
    const dt = Math.min((now - (this.lastTime || now)) / 1000, 0.1);
    this.lastTime = now;

    this.state.update(dt, this);
    if (this.state.current === 'playing') {
      // Per-frame order: update state, cast wall rays, draw world, update DOM.
      const rays = Raycaster.castAll(this.player, this.map, this.canvas.width, CONFIG.FOV);
      Renderer.drawFrame({
        ctx: this.ctx,
        rayResults: rays,
        enemies: this.enemyManager.getLiving(),
        player: this.player,
        map: this.map,
        textures: this.textures,
        showMinimap: this.showMinimap,
        minimapCanvas: this.minimapCanvas,
      });
      HUD.update(this.player);
    }

    if (this.rafId !== null) this.rafId = requestAnimationFrame(this.loop);
  },
};

if (typeof window !== 'undefined') {
  // Expose internals for tests.html and for quick browser-console tweaking.
  Object.assign(window, {
    CONFIG,
    InputHandler,
    MapLoader,
    createPlayer,
    TextureManager,
    Raycaster,
    createEnemy,
    createEnemyManager,
    Renderer,
    HUD,
    StateManager,
    Game,
  });

  window.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('gameCanvas')) Game.init();
  });
}
