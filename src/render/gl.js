/**
 * The graphics API, and the surfaces to put on it.
 *
 * This is the one game in the series that does not draw into a Uint32Array. An
 * arena shooter is a first person view of a lit room with a hundred thousand
 * triangles in it at a hundred and twenty frames a second, and a rasteriser
 * written in JavaScript will not do that on a phone. So: WebGL, and the smallest
 * amount of it that will work - one program for the world, one for everything
 * that moves, no libraries, no shader compiler, no asset pipeline.
 *
 * There are still no files. Every surface in the game is drawn here, into a
 * canvas, out of a seeded random number generator: concrete, panelling, rust,
 * floor plate, lamp trim, two team colours and rock. It costs about eight
 * milliseconds at startup and it means the whole game is still the code.
 */

/** A deterministic little generator, so every player sees the same concrete. */
function rng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getContext(canvas) {
  const attrs = {
    alpha: false,
    antialias: true,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  };
  const gl = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs);
  if (!gl) return null;
  gl.webgl2 = typeof gl.texStorage2D === 'function';
  if (!gl.webgl2) {
    // A map's index buffer runs past sixty-five thousand vertices on the bigger
    // arenas. WebGL 1 needs asking before it will believe that.
    if (!gl.getExtension('OES_element_index_uint')) return null;
  }
  return gl;
}

export function compile(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      throw new Error(`${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader: ${log}`);
    }
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`link: ${gl.getProgramInfoLog(program)}`);
  }
  // Everything the outside needs to talk to the program, looked up once.
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    const name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  const attribs = {};
  const attrCount = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < attrCount; i++) {
    const info = gl.getActiveAttrib(program, i);
    attribs[info.name] = gl.getAttribLocation(program, info.name);
  }
  return { program, uniforms, attribs };
}

export function buffer(gl, target, data, usage) {
  const buf = gl.createBuffer();
  gl.bindBuffer(target, buf);
  gl.bufferData(target, data, usage || gl.STATIC_DRAW);
  return buf;
}

// --- The surfaces ------------------------------------------------------------

const SIZE = 256;

/**
 * Value noise, tiling. Built once per call at a handful of grid sizes and
 * summed, which is a poor man's fractal noise and quite good enough for
 * something that will be seen at an angle in the dark.
 */
function noiseField(seed, grid) {
  const rand = rng(seed);
  const points = new Float32Array(grid * grid);
  for (let i = 0; i < points.length; i++) points[i] = rand();
  return (x, y) => {
    const fx = x * grid;
    const fy = y * grid;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const at = (a, b) => points[(((b % grid) + grid) % grid) * grid + (((a % grid) + grid) % grid)];
    const a = at(ix, iy);
    const b = at(ix + 1, iy);
    const c = at(ix, iy + 1);
    const d = at(ix + 1, iy + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
}

function fbm(seed) {
  const a = noiseField(seed, 4);
  const b = noiseField(seed + 1, 8);
  const c = noiseField(seed + 2, 16);
  const d = noiseField(seed + 3, 64);
  return (x, y) => a(x, y) * 0.5 + b(x, y) * 0.26 + c(x, y) * 0.16 + d(x, y) * 0.08;
}

function makeImage(draw) {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  draw(data, SIZE);
  return data;
}

const put = (data, x, y, r, g, b) => {
  const i = (y * SIZE + x) * 4;
  data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
};

/** A rectangle of seam, one pixel of dark and one of light: a panel edge. */
function seam(data, x0, y0, x1, y1, dark, light) {
  for (let x = x0; x <= x1; x++) {
    for (const [y, k] of [[y0, dark], [y1, light]]) {
      if (y < 0 || y >= SIZE) continue;
      const i = ((y % SIZE) * SIZE + (x % SIZE)) * 4;
      data[i] *= k; data[i + 1] *= k; data[i + 2] *= k;
    }
  }
  for (let y = y0; y <= y1; y++) {
    for (const [x, k] of [[x0, dark], [x1, light]]) {
      if (x < 0 || x >= SIZE) continue;
      const i = ((y % SIZE) * SIZE + (x % SIZE)) * 4;
      data[i] *= k; data[i + 1] *= k; data[i + 2] *= k;
    }
  }
}

function rivets(data, step, radius, shade) {
  for (let cy = step / 2; cy < SIZE; cy += step) {
    for (let cx = step / 2; cx < SIZE; cx += step) {
      for (let y = -radius; y <= radius; y++) {
        for (let x = -radius; x <= radius; x++) {
          const d = Math.sqrt(x * x + y * y);
          if (d > radius) continue;
          const px = (cx + x + SIZE) % SIZE;
          const py = (cy + y + SIZE) % SIZE;
          const lift = shade * (1 - d / radius) * (y < 0 ? 1.25 : 0.75);
          const i = (py * SIZE + px) * 4;
          data[i] *= lift; data[i + 1] *= lift; data[i + 2] *= lift;
        }
      }
    }
  }
}

/**
 * The eight surfaces, in the order MAT names them.
 *
 * Each one is a base colour, some noise to break it up, and one piece of
 * structure - a seam, a rivet, a grout line, a streak of rust - because a flat
 * colour with noise on it reads as fog, and a single straight line in the middle
 * of it reads as a building.
 */
export function makeTextures(gl) {
  const textures = [];
  const grain = fbm(1234);
  const blotch = fbm(99);

  const build = [
    // 0 concrete
    (data) => {
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const n = grain(x / SIZE, y / SIZE);
          const p = blotch(x / SIZE * 0.5, y / SIZE * 0.5);
          const v = 92 + n * 42 + (p > 0.62 ? -16 : 0);
          put(data, x, y, v * 1.0, v * 0.99, v * 0.94);
        }
      }
      seam(data, 0, 0, SIZE - 1, SIZE - 1, 0.72, 1.14);
    },
    // 1 panel
    (data) => {
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const n = grain(x / SIZE * 2, y / SIZE * 0.4);
          const v = 104 + n * 30;
          put(data, x, y, v * 0.94, v * 0.98, v * 1.06);
        }
      }
      seam(data, 0, 0, SIZE - 1, SIZE - 1, 0.62, 1.2);
      seam(data, 0, SIZE / 2, SIZE - 1, SIZE / 2, 0.7, 1.1);
      rivets(data, 64, 4, 1.0);
    },
    // 2 rust
    (data) => {
      const streak = fbm(7);
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const n = grain(x / SIZE, y / SIZE);
          const s = streak(x / SIZE * 3, y / SIZE * 0.25);
          const rustiness = Math.max(0, s - 0.42) * 2.2;
          const v = 86 + n * 34;
          const r = v * (0.86 + rustiness * 0.85);
          const g = v * (0.72 - rustiness * 0.18);
          const b = v * (0.6 - rustiness * 0.3);
          put(data, x, y, r, g, b);
        }
      }
      seam(data, 0, 0, SIZE - 1, SIZE - 1, 0.66, 1.16);
    },
    // 3 floor plate
    (data) => {
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const n = grain(x / SIZE * 1.5, y / SIZE * 1.5);
          const v = 74 + n * 26;
          put(data, x, y, v * 0.95, v * 0.97, v * 1.02);
        }
      }
      // Four plates to the tile, with a groove between them.
      for (const k of [0, SIZE / 2]) {
        seam(data, k, k, k + SIZE / 2 - 1, k + SIZE / 2 - 1, 0.6, 1.18);
      }
      seam(data, 0, SIZE / 2, SIZE / 2 - 1, SIZE - 1, 0.6, 1.18);
      seam(data, SIZE / 2, 0, SIZE - 1, SIZE / 2 - 1, 0.6, 1.18);
      rivets(data, 128, 3, 0.88);
    },
    // 4 trim - the bright one, used for lamps, rails and anything that glows
    (data) => {
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const n = grain(x / SIZE * 4, y / SIZE * 4);
          const band = Math.abs(y - SIZE / 2) < SIZE / 6 ? 1.35 : 0.75;
          const v = (150 + n * 30) * band;
          put(data, x, y, v * 1.0, v * 1.0, v * 0.98);
        }
      }
    },
    // 5 red team
    (data) => {
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const n = grain(x / SIZE * 2, y / SIZE);
          const v = 96 + n * 26;
          const stripe = Math.abs(y - SIZE * 0.5) < 14 ? 1.5 : 1;
          put(data, x, y, v * 1.25 * stripe, v * 0.42, v * 0.38);
        }
      }
      seam(data, 0, 0, SIZE - 1, SIZE - 1, 0.66, 1.18);
      rivets(data, 64, 4, 1.0);
    },
    // 6 blue team
    (data) => {
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const n = grain(x / SIZE * 2, y / SIZE);
          const v = 96 + n * 26;
          const stripe = Math.abs(y - SIZE * 0.5) < 14 ? 1.5 : 1;
          put(data, x, y, v * 0.44, v * 0.72, v * 1.3 * stripe);
        }
      }
      seam(data, 0, 0, SIZE - 1, SIZE - 1, 0.66, 1.18);
      rivets(data, 64, 4, 1.0);
    },
    // 7 rock
    (data) => {
      const crack = fbm(31);
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const n = grain(x / SIZE * 1.2, y / SIZE * 1.2);
          const c = crack(x / SIZE * 2.5, y / SIZE * 2.5);
          const dark = Math.abs(c - 0.5) < 0.03 ? 0.68 : 1;
          const v = (68 + n * 30) * dark;
          put(data, x, y, v * 1.02, v * 0.97, v * 0.86);
        }
      }
    },
  ];

  for (const draw of build) {
    const pixels = makeImage(draw);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SIZE, SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array(pixels.buffer));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic')
      || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    if (aniso) {
      const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
    }
    textures.push(tex);
  }
  return textures;
}

/** One white pixel, for anything drawn in its own colours. */
export function whiteTexture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

// --- Matrices ----------------------------------------------------------------
//
// Column major, the way the API wants them. Four functions, because four is all
// this game needs: a projection, a camera, a model, and the product of them.

export function perspective(out, fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = (far + near) / (near - far); out[11] = -1;
  out[12] = 0; out[13] = 0; out[14] = (2 * far * near) / (near - far); out[15] = 0;
  return out;
}

/** A camera at `eye` looking along (dx, dy, dz), with the world's up. */
export function lookAlong(out, ex, ey, ez, dx, dy, dz) {
  let fx = dx; let fy = dy; let fz = dz;
  const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  // right = forward x (0, 1, 0), which comes out as (-fz, 0, fx). There is no
  // roll in this game, so right is always level and this is the whole of it.
  let rx = -fz;
  let rz = fx;
  const ry = 0;
  const rl = Math.sqrt(rx * rx + rz * rz) || 1;
  rx /= rl; rz /= rl;
  // up = right x forward
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;

  out[0] = rx; out[1] = ux; out[2] = -fx; out[3] = 0;
  out[4] = ry; out[5] = uy; out[6] = -fy; out[7] = 0;
  out[8] = rz; out[9] = uz; out[10] = -fz; out[11] = 0;
  out[12] = -(rx * ex + ry * ey + rz * ez);
  out[13] = -(ux * ex + uy * ey + uz * ez);
  out[14] = fx * ex + fy * ey + fz * ez;
  out[15] = 1;
  return out;
}

export function multiply(out, a, b) {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1]
        + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

/** Position, a turn about the world's up, and a scale. All a model ever needs. */
export function modelMatrix(out, x, y, z, yawRadians, sx = 1, sy = 1, sz = 1) {
  const c = Math.cos(yawRadians);
  const s = Math.sin(yawRadians);
  // Yaw zero faces +x and turns towards +z, which is the convention sinA and
  // cosA use in the simulation. The two have to agree or every model in the
  // game is mirrored.
  out[0] = c * sx; out[1] = 0; out[2] = s * sx; out[3] = 0;
  out[4] = 0; out[5] = sy; out[6] = 0; out[7] = 0;
  out[8] = -s * sz; out[9] = 0; out[10] = c * sz; out[11] = 0;
  out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
  return out;
}
