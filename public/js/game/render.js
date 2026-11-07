// The three.js view of a tomb: built once from the GDF, then synced to the sim state every frame.
// Ported from Gloamhollow's renderer (reference/gloamhollow/Gloamhollow.html: materials, static meshing,
// props, foes, boss, viewmodel, light). Renderer only: it reads the sim state and never writes it.
//
// three r187 vs Gloamhollow's r128 (decision #52): colour management is off and lights use r128's
// "legacy" falloff and π scale, so the tomb looks as it did.
import * as THREE from '../vendor/three/three.module.js';
import * as TX from './textures.js';
import { DELVE_ART, DELVE_H } from './delve-art.js';

const S = 2.4, EYE = 1.62, MM = 1 / 1000;
const TAU = Math.PI * 2;
export const yawRad = (u) => (u * TAU) / 4096;
const CELL = { WALL: 0, ROOM: 1, CORR: 2, PLATE: 3, HPIT: 4, VOID: 5, BRIDGE: 6, VENT: 7, ALCOVE: 8 };
const VOID_D = 16, PIT_D = 7, H_CORR = 3.0;
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const SIDE = { n: [0, -1, 0], s: [0, 1, Math.PI], e: [1, 0, -Math.PI / 2], w: [-1, 0, Math.PI / 2] };
const BELL_R = [0.42, 0.6, 0.78];                    // size 1..3 (Gloamhollow green, brown, great)
const BELL_COL = [[0xc9a14a, 70, 0x8a6a30], [0x7d5a38, 25, 0x302010], [0x5f9c80, 20, 0x203028]]; // patina 0..2
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cx = (i) => (i + 0.5) * S;

// r128 look: hex colours are linear (no colour management); point lights fall off as pow(1 - d/cut, decay).
THREE.ColorManagement.enabled = false;
THREE.ShaderChunk.lights_pars_begin = THREE.ShaderChunk.lights_pars_begin.replace(
  /float getDistanceAttenuation\([\s\S]*?\n\}/,
  `float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	if ( cutoffDistance > 0.0 && decayExponent > 0.0 ) return pow( saturate( - lightDistance / cutoffDistance + 1.0 ), decayExponent );
	return 1.0;
}`);
const PI_L = Math.PI; // legacy lights scaled punctual and ambient intensities by π

class GeoBuilder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; }
  quad(pts, nrm, uvs, cols, tint = [1, 1, 1]) {
    const [a, b, c] = pts;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const qx = uy * vz - uz * vy, qy = uz * vx - ux * vz, qz = ux * vy - uy * vx;
    const order = (qx * nrm[0] + qy * nrm[1] + qz * nrm[2]) < 0 ? [0, 3, 2, 1] : [0, 1, 2, 3];
    const base = this.p.length / 3;
    for (const k of order) { this.p.push(...pts[k]); this.n.push(...nrm); this.uv.push(...uvs[k]); const s = cols[k]; this.c.push(s * tint[0], s * tint[1], s * tint[2]); }
    this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i); g.computeBoundingSphere();
    return g;
  }
}

export class TombView {
  /** @param tomb {gdf, grid, w, h, world} from main.js; canvas the #view element. */
  constructor(canvas, tomb, opts) {
    this.T = tomb; this.reduced = opts.reduced; this.coarse = opts.coarse;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.coarse ? 1.5 : 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.2;
    r.autoClear = false; r.setClearColor(0x0b0a0c, 1);
    this.renderer = r; this.aniso = Math.min(8, r.capabilities.getMaxAnisotropy());
    const scene = new THREE.Scene(); this.scene = scene;
    scene.background = new THREE.Color(0x0b0a0c); scene.fog = new THREE.FogExp2(0x0b0a0c, 0.06);
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 90); this.camera.rotation.order = 'YXZ';
    this.ambient = new THREE.AmbientLight(0x6a5e5a, 0.3 * PI_L); scene.add(this.ambient);
    this.lantern = new THREE.PointLight(0xffc27c, 1.35 * PI_L, 14, 1.6); scene.add(this.lantern);
    this.torchPool = []; for (let k = 0; k < 4; k++) { const l = new THREE.PointLight(0xbfdcff, 0, 12, 1.6); scene.add(l); this.torchPool.push({ light: l, torch: -1 }); }
    this.fxPool = []; for (let k = 0; k < 4; k++) { const l = new THREE.PointLight(0xff9a46, 0, 10, 1.6); scene.add(l); this.fxPool.push(l); }
    this.world = new THREE.Group(); scene.add(this.world);
    this.ents = new THREE.Group(); scene.add(this.ents);
    this.time = 0; this.hoodMix = 0; this.starve = 0; this.shake = 0; this.sink = 0; this.fallV = 0;
    this.litSprites = []; this.slabMeshes = new Map(); this.xMeshes = new Map(); this.pebbles = []; this.flyers = []; this.shotSprites = [];
    this.makeMaterials();
    this.index();
    this.buildStatic();
    this.buildEntities();
    this.buildViewmodel();
  }

  // ---------------------------------------------------------------- lookups from the GDF
  index() {
    const { gdf, grid, w, h } = this.T;
    this.zoneOf = new Int8Array(w * h).fill(-1);
    (gdf.zones ?? []).forEach((z, zi) => { for (const [x, y, rw, rh] of z.rects) for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) this.zoneOf[j * w + i] = zi; });
    this.ceilOf = new Float32Array(w * h);
    for (let k = 0; k < w * h; k++) { const z = this.zoneOf[k]; this.ceilOf[k] = z >= 0 ? gdf.zones[z].ceil * MM : H_CORR; }
    this.ents_ = gdf.entities ?? [];
    this.byType = (t) => this.ents_.filter((e) => e.type === t);
    this.num = new Map(this.ents_.map((e, n) => [e.id, n + 1]));
    this.doorAt = new Map(); this.byType('door').forEach((d, n) => this.doorAt.set(d.cell[1] * w + d.cell[0], n));
    this.slabAt = new Set(this.byType('slab').map((s) => s.cell[1] * w + s.cell[0]));
    this.alcoveAt = new Map(this.byType('alcove').map((a) => [a.cell[1] * w + a.cell[0], a]));
    this.inB = (i, j) => i >= 0 && j >= 0 && i < w && j < h;
    this.code = (i, j) => (this.inB(i, j) ? grid[j * w + i] : CELL.WALL);
  }
  isOpen(i, j) { return this.code(i, j) !== CELL.WALL; }
  solidWall(i, j) { return this.code(i, j) === CELL.WALL; }
  ao(vi, vj) { const AO = [1, 0.7, 0.47, 0.34]; return AO[(this.solidWall(vi - 1, vj - 1) ? 1 : 0) + (this.solidWall(vi, vj - 1) ? 1 : 0) + (this.solidWall(vi - 1, vj) ? 1 : 0) + (this.solidWall(vi, vj) ? 1 : 0)]; }
  tintOf(k) { const z = this.zoneOf[k], t = z >= 0 ? this.T.gdf.zones[z].tint : undefined; return t ? t.map((c) => c / 255) : [1, 1, 1]; }

  // ---------------------------------------------------------------- materials
  tex(canvas, srgb = true, nearest = false) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = this.aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
    return t;
  }
  makeMaterials() {
    const tex = (c, s, n) => this.tex(c, s, n);
    const brick = TX.makeBrick(), flag = TX.makeFlag(), cob = TX.makeCobble();
    const phong = (o) => new THREE.MeshPhongMaterial(o);
    const additive = (map, o = {}) => new THREE.SpriteMaterial(Object.assign({ map, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }, o));
    const glow = (stops) => tex(TX.makeGlow(stops));
    this.glowFlame = glow([[0, 'rgba(255,248,226,1)'], [0.18, 'rgba(255,214,140,.95)'], [0.42, 'rgba(255,140,52,.45)'], [0.7, 'rgba(200,70,20,.12)'], [1, 'rgba(0,0,0,0)']]);
    const glowCold = glow([[0, 'rgba(250,252,255,1)'], [0.2, 'rgba(200,228,255,.95)'], [0.45, 'rgba(120,170,255,.45)'], [0.72, 'rgba(60,90,200,.12)'], [1, 'rgba(0,0,0,0)']]);
    const glowEye = glow([[0, 'rgba(255,250,220,1)'], [0.2, 'rgba(255,200,90,.9)'], [0.55, 'rgba(255,90,30,.35)'], [1, 'rgba(0,0,0,0)']]);
    const glowGhost = glow([[0, 'rgba(230,250,255,1)'], [0.25, 'rgba(150,220,250,.8)'], [0.6, 'rgba(70,150,220,.25)'], [1, 'rgba(0,0,0,0)']]);
    const glowDay = glow([[0, 'rgba(255,255,250,1)'], [0.3, 'rgba(255,246,220,.85)'], [0.7, 'rgba(255,230,180,.25)'], [1, 'rgba(0,0,0,0)']]);
    const M = {
      wall: phong({ map: tex(brick.color), bumpMap: tex(brick.bump, false), bumpScale: 0.035, vertexColors: true, shininess: 8, specular: 0x1a1612 }),
      shelf: phong({ map: tex(TX.makeShelf()), vertexColors: true, shininess: 4, specular: 0x000000 }),
      floor: phong({ map: tex(flag.color), bumpMap: tex(flag.bump, false), bumpScale: 0.025, vertexColors: true, shininess: 14, specular: 0x221c16 }),
      cobble: phong({ map: tex(cob.color), bumpMap: tex(cob.bump, false), bumpScale: 0.03, vertexColors: true, shininess: 10, specular: 0x1c1712 }),
      ceil: phong({ map: tex(TX.makeCeil()), vertexColors: true, shininess: 2, specular: 0x000000 }),
      stone: phong({ map: tex(flag.color), color: 0xa49a8c, shininess: 6 }),
      slab: phong({ map: tex(flag.color), color: 0x8c847a, shininess: 4 }),
      statue: phong({ color: 0x6e6860, shininess: 6, specular: 0x111111 }),
      iron: phong({ color: 0x24201c, shininess: 40, specular: 0x3a3530 }),
      wood: phong({ color: 0x4a3626, shininess: 6 }),
      mirror: phong({ color: 0xd6e0e8, emissive: 0x2c3842, shininess: 120, specular: 0xffffff, side: THREE.DoubleSide }),
      mirrorBack: phong({ color: 0x2a2624, shininess: 10 }),
      stoneDoor: phong({ map: tex(TX.makeStoneDoor(11)), shininess: 6 }),
      grateDoor: phong({ map: tex(TX.makeGrateDoor()), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, shininess: 30 }),
      plainChest: phong({ map: tex(TX.makePlanks(128, 96, 56, false)), shininess: 8 }),
      gildChest: phong({ map: tex(TX.makePlanks(128, 96, 57, true)), shininess: 60, specular: 0x7a6020 }),
      plaque: phong({ map: tex(TX.makeCarving(6, 256, 176, 5, true)), shininess: 50, specular: 0x5a4020 }),
      carving: phong({ map: tex(TX.makeCarving(5, 256, 200, 9)), shininess: 6 }),
      carving2: phong({ map: tex(TX.makeCarving(2, 256, 96, 12)), shininess: 6 }),
      scrawl: new THREE.MeshBasicMaterial({ map: tex(TX.makeScrawl()), transparent: true, opacity: 0.8, depthWrite: false }),
      scorch: new THREE.MeshBasicMaterial({ map: tex(TX.makeGlow([[0, 'rgba(0,0,0,.85)'], [0.6, 'rgba(10,8,6,.6)'], [1, 'rgba(0,0,0,0)']])), transparent: true, depthWrite: false }),
      eye: phong({ map: tex(TX.makeEye(0)), shininess: 6 }),
      mark: new THREE.MeshBasicMaterial({ map: tex(TX.makeMark()), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      xmark: new THREE.MeshBasicMaterial({ map: tex(TX.makeX()), transparent: true, opacity: 0.85, depthWrite: false }),
      ghost: new THREE.MeshBasicMaterial({ map: tex(TX.makeGhost()), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      ghostKnown: new THREE.MeshBasicMaterial({ map: tex(TX.makeGhost()), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      beam: new THREE.MeshBasicMaterial({ color: 0xffd890, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }),
      water: phong({ map: tex(TX.makeWater()), color: 0x9ab8cc, transparent: true, opacity: 0.88, shininess: 90, specular: 0x88aacc }),
      crystal: phong({ color: 0x8aa0b0, emissive: 0xffc860, emissiveIntensity: 0, shininess: 120, specular: 0xffffff, transparent: true, opacity: 0.9 }),
      brazier: phong({ color: 0x2c2620, shininess: 30, specular: 0x3a3028 }),
      sarc: phong({ map: tex(TX.makeCarving(4, 256, 128, 21)), color: 0x9a9088, shininess: 8 }),
      day: new THREE.MeshBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      mask: {}, flame: additive(this.glowFlame), cold: additive(glowCold), eyeGlow: additive(glowEye), ghostSpr: additive(glowGhost), daySpr: additive(glowDay),
      shaft: new THREE.MeshBasicMaterial({ color: 0x050405 }),
    };
    for (const f of ['weep', 'laugh', 'sleep', 'blank']) M.mask[f] = phong({ map: tex(f === 'blank' ? TX.makeStoneDoor(74) : TX.makeMask(f)), shininess: 6 });
    M.beamGlint = additive(this.glowFlame);
    M.grateTex = { map: tex(TX.makeGrate()), emissiveMap: tex(TX.makeGrateGlow()) };
    this.EYE_TEX = [0, 1, 2].map((n) => tex(TX.makeEye(n)));
    this.TEXS = {};
    for (const k in TX.ART) this.TEXS[k] = tex(TX.ART[k], true, true);
    for (const k in TX.ICON) this.TEXS['i_' + k] = tex(TX.ICON[k], true, true);
    this.M = M;
  }

  // ---------------------------------------------------------------- static meshing (Gloamhollow buildStatic)
  wallFace(b, i, j, dx, dy, y0, y1, c0, c1, tint) {
    const x0 = i * S, x1 = x0 + S, z0 = j * S, z1 = z0 + S;
    let pts, uvs;
    if (dx !== 0) {
      const x = dx > 0 ? x1 : x0;
      pts = [[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]];
      uvs = [[z0 / S, y0 / S], [z1 / S, y0 / S], [z1 / S, y1 / S], [z0 / S, y1 / S]];
    } else {
      const z = dy > 0 ? z1 : z0;
      pts = [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];
      uvs = [[x0 / S, y0 / S], [x1 / S, y0 / S], [x1 / S, y1 / S], [x0 / S, y1 / S]];
    }
    b.quad(pts, [-dx, 0, -dy], uvs, [c0, c0, c1, c1], tint);
  }
  floorQuad(b, i, j, y = 0) {
    const x0 = i * S, x1 = x0 + S, z0 = j * S, z1 = z0 + S;
    b.quad([[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]], [0, 1, 0], [[i, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]], [this.ao(i, j), this.ao(i, j + 1), this.ao(i + 1, j + 1), this.ao(i + 1, j)]);
  }
  buildStatic() {
    const { w, h, gdf } = this.T, M = this.M;
    const bw = new GeoBuilder(), bs = new GeoBuilder(), bf = new GeoBuilder(), bt = new GeoBuilder(), bc = new GeoBuilder();
    const vents = this.byType('vent'), ventOf = new Map(), bv = vents.map(() => new GeoBuilder());
    vents.forEach((v, n) => { for (const [i, j] of v.cells) ventOf.set(j * w + i, n); });
    this.pitMesh = new Map();
    const voidish = (k) => { const c = this.T.grid[k]; return c === CELL.VOID || c === CELL.BRIDGE; };
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i, code = this.T.grid[k]; if (code === CELL.WALL) continue;
      const hgt = this.ceilOf[k], z = this.zoneOf[k], tint = this.tintOf(k), vd = voidish(k);
      const wb = z >= 0 && gdf.zones[z].walls === 'shelves' ? bs : bw;
      const al = this.alcoveAt.get(k), pit = code === CELL.HPIT || (al && al.kind === 'tip');
      if (pit) {
        const cb = new GeoBuilder(); this.floorQuad(cb, i, j);
        const cover = new THREE.Mesh(cb.build(), code === CELL.CORR ? M.cobble : M.floor); this.world.add(cover);
        const sb = new GeoBuilder();
        for (const [dx, dy] of DIRS4) this.wallFace(sb, i, j, dx, dy, -PIT_D, 0, 0.12, 0.55);
        const x0 = i * S, x1 = x0 + S, z0 = j * S, z1 = z0 + S;
        sb.quad([[x0, -PIT_D, z0], [x0, -PIT_D, z1], [x1, -PIT_D, z1], [x1, -PIT_D, z0]], [0, 1, 0], [[0, 0], [0, 1], [1, 1], [1, 0]], [0.05, 0.05, 0.05, 0.05]);
        const shaft = new THREE.Mesh(sb.build(), M.wall); shaft.visible = false; this.world.add(shaft);
        this.pitMesh.set(k, { cover, shaft });
      } else if (code === CELL.VENT && ventOf.has(k)) this.floorQuad(bv[ventOf.get(k)], i, j);
      else if (!vd) this.floorQuad(code === CELL.CORR ? bt : bf, i, j);
      const x0 = i * S, x1 = x0 + S, z0 = j * S, z1 = z0 + S;
      const ca = [this.ao(i, j), this.ao(i, j + 1), this.ao(i + 1, j + 1), this.ao(i + 1, j)].map((v) => 0.5 + 0.5 * v);
      bc.quad([[x0, hgt, z0], [x0, hgt, z1], [x1, hgt, z1], [x1, hgt, z0]], [0, -1, 0], [[i, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]], ca, tint);
      for (const [dx, dy] of DIRS4) {
        const ni = i + dx, nj = j + dy;
        if (this.solidWall(ni, nj)) { this.wallFace(wb, i, j, dx, dy, vd ? -VOID_D : 0, hgt, vd ? 0.1 : 0.42, 0.95, tint); continue; }
        const nk = nj * w + ni;
        if (vd && !voidish(nk)) this.wallFace(bw, i, j, dx, dy, -VOID_D, 0, 0.08, 0.6, tint);
        const hn = this.ceilOf[nk]; if (hn < hgt) this.wallFace(wb, i, j, dx, dy, hn, hgt, 0.8, 0.95, tint);
      }
    }
    for (const [b, m] of [[bw, M.wall], [bs, M.shelf], [bf, M.floor], [bt, M.cobble], [bc, M.ceil]]) if (b.p.length) this.world.add(new THREE.Mesh(b.build(), m));
    this.ventMesh = bv.map((b) => {
      const m = new THREE.Mesh(b.build(), new THREE.MeshPhongMaterial({ ...M.grateTex, emissive: 0xff7a2a, emissiveIntensity: 0, shininess: 20, vertexColors: true }));
      this.world.add(m); return m;
    });
  }

  // ---------------------------------------------------------------- props and entities (Gloamhollow buildProps)
  mesh(geo, mat, x, y, z, parent = this.world) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; }
  wallMount(obj, i, j, side, y, off = 0.02) {
    const [dx, dz, ry] = SIDE[side], hh = S / 2 - off;
    obj.position.set(cx(i) + dx * hh, y, cx(j) + dz * hh); obj.rotation.y = ry; this.world.add(obj); return obj;
  }
  makeSprite(texture, hgt, parent = this.ents) {
    const m = new THREE.SpriteMaterial({ map: texture, transparent: true, alphaTest: 0.5 });
    const s = new THREE.Sprite(m); s.center.set(0.5, 0); s.scale.set(hgt * texture.image.width / texture.image.height, hgt, 1); parent.add(s); return s;
  }
  propSprite(texture, hgt, x, y, z) { const s = this.makeSprite(texture, hgt, this.world); s.position.set(x, y, z); this.litSprites.push(s); return s; }
  kneeler(x, z, face) {
    const g = new THREE.Group(), M = this.M.statue, mesh = (...a) => this.mesh(...a);
    mesh(new THREE.BoxGeometry(0.9, 0.22, 0.9), this.M.stone, 0, 0.11, 0, g);
    mesh(new THREE.BoxGeometry(0.5, 0.36, 0.62), M, 0, 0.4, 0.06, g);
    const torso = mesh(new THREE.BoxGeometry(0.48, 0.74, 0.32), M, 0, 0.94, -0.02, g); torso.rotation.x = 0.12;
    mesh(new THREE.SphereGeometry(0.17, 12, 10), M, 0, 1.47, -0.08, g);
    for (const s of [-1, 1]) { const a = mesh(new THREE.BoxGeometry(0.12, 0.12, 0.46), M, s * 0.2, 1.08, -0.3, g); a.rotation.x = -0.35; }
    mesh(new THREE.CylinderGeometry(0.26, 0.12, 0.13, 14), M, 0, 1.26, -0.56, g);
    g.position.set(x, 0, z); g.rotation.y = face; this.world.add(g);
  }
  bellGeo(r) {
    const p = [[0.02, 1.0], [0.26, 0.98], [0.4, 0.9], [0.45, 0.7], [0.47, 0.46], [0.56, 0.22], [0.76, 0.06], [0.82, 0.0], [0.74, 0.02], [0.5, 0.18], [0.42, 0.42], [0.38, 0.82], [0.02, 0.9]];
    return new THREE.LatheGeometry(p.map(([x, y]) => new THREE.Vector2(x * r / 0.82, y * r * 1.5)), 28);
  }
  buildEntities() {
    const M = this.M, { w } = this.T, mesh = (...a) => this.mesh(...a);
    const E = { doors: [], items: new Map(), bells: new Map(), mirrors: [], braziers: [], chests: [], foes: [], eyes: [], eyeGlows: [], marks: [], bridge: new Map(), vents: [], water: new Map(), torches: [], flames: [] };
    this.E = E;
    const sarcs = this.byType('prop').filter((p) => p.kind === 'sarcophagus');
    for (const p of this.byType('prop')) {
      const x = p.pos[0] * MM, z = p.pos[1] * MM, ry = yawRad(p.yaw);
      if (p.kind === 'statue') this.kneeler(x, z, ry);
      else if (p.kind === 'stele') { const st = mesh(new THREE.BoxGeometry(0.9, 1.7, 0.32), [M.carving, M.carving, M.stone, M.stone, M.carving, M.carving], x, 0.85, z); st.rotation.y = ry; }
      else if (p.kind === 'tree') {
        mesh(new THREE.CylinderGeometry(0.28, 0.42, 5.4, 10), M.statue, x, 2.7, z);
        for (let k = 0; k < 4; k++) { const b = mesh(new THREE.CylinderGeometry(0.06, 0.12, 1.6, 6), M.statue, x + Math.cos(k * 1.6) * 0.5, 4.3, z + Math.sin(k * 1.6) * 0.5); b.rotation.z = Math.cos(k * 1.6) * 0.9; b.rotation.x = -Math.sin(k * 1.6) * 0.9; }
      } else if (p.kind === 'post') mesh(new THREE.BoxGeometry(0.2, 3.9, 0.2), M.wood, x, 3.9 / 2, z);
      else if (p.kind === 'plinth') mesh(new THREE.BoxGeometry(0.7, 1.1, 0.7), [M.carving2, M.carving2, M.stone, M.stone, M.carving2, M.carving2], x, 0.55, z).rotation.y = ry;
      else if (p.kind === 'lectern') {
        const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
        mesh(new THREE.BoxGeometry(0.5, 1.05, 0.4), M.wood, 0, 0.52, 0, g);
        const top = mesh(new THREE.BoxGeometry(0.9, 0.06, 0.62), M.wood, 0, 1.12, 0, g); top.rotation.x = 0.35;
        const pg = new THREE.MeshPhongMaterial({ color: 0xd8ccb0, shininess: 2 });
        for (const s of [-1, 1]) { const pp = mesh(new THREE.PlaneGeometry(0.36, 0.48), pg, s * 0.19, 1.17, 0.0, g); pp.rotation.x = -Math.PI / 2 + 0.35; pp.rotation.y = s * 0.08; }
        this.world.add(g);
      } else if (p.kind === 'sarcophagus') {
        const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; this.world.add(g);
        mesh(new THREE.BoxGeometry(1.4, 1.0, 2.2), M.sarc, 0, 0.5, 0, g);
        E.sarcLid = mesh(new THREE.BoxGeometry(1.5, 0.18, 2.3), M.stone, 0, 1.09, 0, g); E.lidT = 0;
      }
    }
    // doors
    this.byType('door').forEach((d) => {
      const [i, j] = d.cell, k = j * w + i, ns = this.isOpen(i, j - 1) || this.isOpen(i, j + 1), hgt = this.ceilOf[k];
      const geo = ns ? new THREE.BoxGeometry(S, hgt, 0.32) : new THREE.BoxGeometry(0.32, hgt, S);
      let mat = d.style === 'grate' ? M.grateDoor : M.stoneDoor;
      if (d.style === 'mask') { const f = M.mask[d.face]; mat = ns ? [M.stoneDoor, M.stoneDoor, M.stoneDoor, M.stoneDoor, f, f] : [f, f, M.stoneDoor, M.stoneDoor, M.stoneDoor, M.stoneDoor]; }
      E.doors.push({ def: d, mesh: mesh(geo, mat, cx(i), hgt / 2, cx(j)), h: hgt, grate: d.style === 'grate' });
    });
    // old slabs, a skeleton's hand under each
    for (const s of this.byType('slab')) { const [i, j] = s.cell; mesh(new THREE.BoxGeometry(S * 0.98, 0.55, S * 0.98), M.slab, cx(i), 0.275, cx(j)); this.propSprite(this.TEXS.hand, 0.22, cx(i) + 0.4, 0, cx(j) + S / 2 + 0.06); }
    // masons' marks: jittered rings on each cell, seen when hooded
    for (const mk of this.byType('marks')) for (const [i, j] of mk.cells) {
      const m = mesh(new THREE.PlaneGeometry(0.62, 0.62), M.mark, cx(i) + (((i * 7 + j * 3) % 5) - 2) * 0.12, 0.015, cx(j) + (((i * 3 + j * 5) % 5) - 2) * 0.12);
      m.rotation.x = -Math.PI / 2; m.rotation.z = i + j; E.marks.push(m);
    }
    // inscriptions on walls
    for (const t of this.byType('inscription')) {
      if (!t.wall) continue;
      const [[i, j], side] = t.wall;
      if (t.style === 'plaque') this.wallMount(new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.86), M.plaque), i, j, side, 1.65);
      else if (t.style === 'carving') this.wallMount(new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.6), M.carving2), i, j, side, 1.8);
      else if (t.style === 'scrawl') this.wallMount(new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.52), M.scrawl), i, j, side, 1.55);
    }
    // decor
    for (const d of this.byType('decor')) {
      const x = d.pos[0] * MM, z = d.pos[1] * MM;
      if (d.kind === 'scorch') { const s = mesh(new THREE.PlaneGeometry(2.0, 2.0), M.scorch, x, 0.012, z); s.rotation.x = -Math.PI / 2; }
      else if (d.kind === 'burnt') this.propSprite(this.TEXS.burnt, 0.5, x, 0.02, z);
      else if (d.kind === 'bones') this.propSprite(this.TEXS.bones, 0.42, x, 0, z);
      else if (d.kind === 'candles') this.propSprite(this.TEXS.candles, 0.28, x, 0, z);
      else if (d.kind === 'stair') {
        const g = new THREE.Group(), n = 9, top = 3.4; g.position.set(x, 0, z); g.rotation.y = yawRad(d.yaw);
        for (let s = 0; s < n; s++) { const sh = (s + 1) * top / n; mesh(new THREE.BoxGeometry(S * 0.9, sh, S / n), M.stone, 0, sh / 2, -S / 2 + (s + 0.5) * S / n, g); }
        this.world.add(g);
      }
    }
    // waking eyes: carvings every other cell along the zone's north and south walls
    for (const ey of this.byType('eyes')) {
      const zi = this.T.gdf.zones.findIndex((z) => z.id === ey.zone), z = this.T.gdf.zones[zi];
      for (const [x0, y0, rw, rh] of z.rects) for (let j = y0; j < y0 + rh; j++) for (let i = x0; i < x0 + rw; i += 2) for (const side of ['n', 's']) {
        const [dx, dz] = SIDE[side]; if (!this.solidWall(i + dx, j + dz)) continue;
        E.eyes.push(this.wallMount(new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.65), M.eye), i, j, side, 1.85));
        const g = new THREE.Sprite(M.eyeGlow.clone()); g.material.opacity = 0; g.scale.set(0.5, 0.5, 1);
        g.position.set(cx(i) + dx * (S / 2 - 0.12), 1.85, cx(j) + dz * (S / 2 - 0.12)); this.world.add(g); E.eyeGlows.push({ g, eyes: this.byType('eyes').indexOf(ey) });
      }
    }
    // bells, hung from a beam between the frame's posts
    const bells = this.byType('bell');
    if (bells.length) {
      const y = 3.9, xs = bells.map((b) => cx(b.cell[0])), z = cx(bells[0].cell[1]), xa = Math.min(...xs) - S * 0.62, xb = Math.max(...xs) + S * 0.62;
      mesh(new THREE.BoxGeometry(xb - xa + 0.3, 0.24, 0.24), M.wood, (xa + xb) / 2, y, z);
      for (const b of bells) {
        const r = BELL_R[b.size - 1], [col, shin, spec] = BELL_COL[b.patina];
        const piv = new THREE.Group(); piv.position.set(cx(b.cell[0]), y - 0.12, cx(b.cell[1])); this.world.add(piv);
        mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), M.iron, 0, -0.2, 0, piv);
        mesh(this.bellGeo(r), new THREE.MeshPhongMaterial({ color: col, shininess: shin, specular: spec, side: THREE.DoubleSide }), 0, -0.4 - r * 1.5, 0, piv);
        mesh(new THREE.SphereGeometry(r * 0.18, 8, 6), M.iron, 0, -0.32 - r * 1.35, 0, piv);
        E.bells.set(b.id, { piv, swing: 0, def: b });
      }
    }
    // vents: fire sprites over each cell
    this.byType('vent').forEach((v, n) => {
      const spr = [];
      for (const [i, j] of v.cells) for (let a = 0; a < 3; a++) { const s = new THREE.Sprite(M.flame.clone()); s.material.opacity = 0; s.position.set(cx(i) + (a - 1) * 0.6, 0.6, cx(j) + (a - 1) * 0.3); s.scale.set(1.1, 2.2, 1); this.world.add(s); spr.push(s); }
      const mid = v.cells[(v.cells.length / 2) | 0];
      E.vents.push({ def: v, spr, mesh: this.ventMesh[n], x: cx(mid[0]), z: cx(mid[1]) });
    });
    // the lamp hook, with your lantern when it hangs there
    E.hooks = this.byType('lampHook').map((hk) => {
      const [i, j] = hk.cell, d = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }[hk.dir];
      const m = mesh(new THREE.BoxGeometry(0.08, 0.08, 0.36), M.iron, cx(i) - d[0] * 1.02, 1.9, cx(j) - d[1] * 1.02); m.rotation.y = Math.atan2(d[0], d[1]);
      const lam = new THREE.Group(); lam.position.set(cx(i) - d[0] * 0.86, 1.62, cx(j) - d[1] * 0.86);
      mesh(new THREE.BoxGeometry(0.2, 0.26, 0.2), M.iron, 0, 0, 0, lam); const core = new THREE.Sprite(M.flame); core.scale.set(0.5, 0.5, 1); lam.add(core);
      lam.visible = false; this.world.add(lam);
      return { def: hk, lam, x: cx(i) - d[0] * 0.86, z: cx(j) - d[1] * 0.86 };
    });
    for (const m of this.byType('mirror')) {
      const [i, j] = m.cell;
      mesh(new THREE.CylinderGeometry(0.22, 0.32, 1.0, 10), M.stone, cx(i), 0.5, cx(j));
      const piv = new THREE.Group(); piv.position.set(cx(i), 1.55, cx(j)); this.world.add(piv);
      mesh(new THREE.PlaneGeometry(1.1, 1.0), M.mirror, 0, 0, 0.02, piv);
      mesh(new THREE.BoxGeometry(1.16, 1.06, 0.03), M.mirrorBack, 0, 0, -0.01, piv);
      E.mirrors.push({ def: m, piv, ang: null });
    }
    E.crystals = this.byType('crystal').map((c) => {
      const [i, j] = c.cell, [dx, dz] = SIDE[c.wall];
      const m = this.wallMount(new THREE.Mesh(new THREE.OctahedronGeometry(0.32), M.crystal), i, j, c.wall, 1.7, 0.2); m.scale.set(1, 1.3, 0.5);
      const g = new THREE.Sprite(M.flame.clone()); g.material.opacity = 0; g.scale.set(1.6, 1.6, 1); g.position.set(cx(i) + dx * (S / 2 - 0.3), 1.7, cx(j) + dz * (S / 2 - 0.3)); this.world.add(g);
      return { def: c, glow: g, x: g.position.x, z: g.position.z };
    });
    E.beam = new THREE.Group(); this.world.add(E.beam); E.beamKey = '';
    this.byType('chest').forEach((c) => {
      const [i, j] = c.cell, [dx, dz] = SIDE[c.wall], ry = { n: 0, s: Math.PI, e: -Math.PI / 2, w: Math.PI / 2 }[c.wall];
      const g = new THREE.Group(); g.position.set(cx(i) + dx * 0.25, 0, cx(j) + dz * 0.25); g.rotation.y = ry; this.world.add(g);
      const m = c.style === 'gilded' ? M.gildChest : M.plainChest;
      mesh(new THREE.BoxGeometry(1.1, 0.6, 0.7), m, 0, 0.3, 0, g);
      const lid = new THREE.Group(); lid.position.set(0, 0.6, -0.35); g.add(lid);
      mesh(new THREE.BoxGeometry(1.12, 0.16, 0.72), m, 0, 0.08, 0.36, lid);
      E.chests.push({ def: c, lid, anim: 0, x: g.position.x, z: g.position.z });
    });
    // the unlit road
    for (let k = 0; k < this.T.grid.length; k++) if (this.T.grid[k] === CELL.BRIDGE) {
      const i = k % w, j = (k / w) | 0;
      const a = mesh(new THREE.PlaneGeometry(S * 0.98, S * 0.98), M.ghost, cx(i), -0.03, cx(j)); a.rotation.x = -Math.PI / 2;
      const b = mesh(new THREE.PlaneGeometry(S * 0.98, S * 0.98), M.ghostKnown, cx(i), -0.02, cx(j)); b.rotation.x = -Math.PI / 2; b.visible = false;
      E.bridge.set(k, b);
    }
    // alcoves: the weeping one fills with water
    for (const a of this.byType('alcove')) if (a.kind === 'drown') {
      const [i, j] = a.cell, m = mesh(new THREE.BoxGeometry(S * 0.98, 1, S * 0.98), M.water, cx(i), -0.5, cx(j)); m.scale.y = 0.001; m.visible = false;
      E.water.set(a.id, { m, t: -1 });
    }
    // braziers
    for (const b of this.byType('brazier')) {
      const [i, j] = b.cell, g = new THREE.Group(); g.position.set(cx(i), 0, cx(j)); this.world.add(g);
      mesh(new THREE.CylinderGeometry(0.1, 0.24, 1.0, 8), M.brazier, 0, 0.5, 0, g);
      mesh(new THREE.CylinderGeometry(0.55, 0.3, 0.32, 14, 1, true), M.brazier, 0, 1.12, 0, g);
      mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 14), M.iron, 0, 0.98, 0, g);
      const f = new THREE.Sprite(M.flame.clone()); f.position.set(0, 1.55, 0); f.scale.set(1.2, 1.6, 1); f.material.opacity = 0; g.add(f);
      E.braziers.push({ def: b, f, x: cx(i), z: cx(j) });
    }
    // the daylight shaft over the exit
    const ex = this.T.gdf.exit;
    if (ex) {
      const [i, j] = ex.cell, hgt = this.ceilOf[j * w + i];
      E.day = mesh(new THREE.CylinderGeometry(1.0, 1.25, hgt, 20, 1, true), M.day, cx(i), hgt / 2, cx(j)); E.day.visible = false;
      E.daySpr = new THREE.Sprite(M.daySpr.clone()); E.daySpr.material.opacity = 0; E.daySpr.scale.set(4, 4, 1); E.daySpr.position.set(cx(i), hgt - 0.6, cx(j)); E.daySpr.visible = false; this.world.add(E.daySpr);
      E.dayT = 0; E.exitX = cx(i); E.exitZ = cx(j);
    }
    // items and rubble (items in chests are never drawn)
    this.byType('item').forEach((it) => {
      if (!it.cell) return;
      const [i, j] = it.cell, txt = this.T.text.items?.[it.id];
      if (it.kind === 'rubble') { E.items.set(it.id, { def: it, s: this.propSprite(this.TEXS.rubble, 0.26, cx(i) - 0.3, 0, cx(j) - 0.3), rubble: true }); return; }
      const icon = it.kind === 'flask' ? 'flask' : txt?.icon ?? (it.kind === 'key' ? 'key' : 'coins');
      const onSarc = sarcs.some((p) => Math.abs(p.pos[0] * MM - cx(i)) < 0.8 && Math.abs(p.pos[1] * MM - cx(j)) < 1.2);
      const s = this.makeSprite(this.TEXS['i_' + icon], icon === 'heart' ? 0.42 : it.kind === 'flask' ? 0.34 : 0.3);
      const y = onSarc ? 1.2 : 0.16; s.position.set(cx(i), y, cx(j));
      E.items.set(it.id, { def: it, s, y, ph: i * 1.7 + j });
    });
    // foes and the boss
    this.T.foeKinds = this.byType('foe').map((f) => f.kind);
    // Gloamhollow's bone gardener (`warden`) and gloam crawler keep their sprites; Lantern Delve's 26 use its pixel art.
    this.delveTex = {};
    for (const f of this.byType('foe')) {
      const crawler = f.kind === 'crawler', gloam = crawler || f.kind === 'warden';
      const hgt = gloam ? (crawler ? 0.62 : 1.75) : DELVE_H[f.kind] ?? 1.5;
      const tx = gloam ? this.TEXS[f.kind] : (this.delveTex[f.kind] ??= this.tex(DELVE_ART[f.kind], true, true));
      const s = this.makeSprite(tx, hgt);
      s.material.transparent = true; s.material.alphaTest = 0.05; s.visible = false;
      let glow = null; if (crawler) { glow = new THREE.Sprite(M.eyeGlow.clone()); glow.material.opacity = 0.55; glow.scale.set(0.22, 0.22, 1); this.ents.add(glow); }
      const fly = this.T.bestiary(f.kind)?.mover === 'fly', invisible = this.T.bestiary(f.kind)?.power === 'invisible';
      // R-MIMIC-1: a disguised xeroc looks like what it pretends to be until it is found out.
      let disg = null;
      if (f.disguise === 'chest') {
        disg = new THREE.Group(); disg.position.set(cx(f.cell[0]), 0, cx(f.cell[1]));
        this.mesh(new THREE.BoxGeometry(1.1, 0.6, 0.7), M.plainChest, 0, 0.3, 0, disg); this.mesh(new THREE.BoxGeometry(1.12, 0.16, 0.72), M.plainChest, 0, 0.68, 0, disg);
        this.world.add(disg);
      } else if (f.disguise) {
        disg = this.makeSprite(this.TEXS[f.disguise === 'flask' ? 'i_flask' : 'i_coins'], f.disguise === 'flask' ? 0.34 : 0.3);
        disg.position.set(cx(f.cell[0]), 0.16, cx(f.cell[1]));
      }
      E.foes.push({ def: f, s, glow, h: hgt, min: crawler ? 0.22 : 0.3, crawler, fly, invisible, disg, ph: f.cell[0] * 1.3 + f.cell[1], flash: 0, hp: -1, deadT: -1 });
    }
    const bd = this.byType('boss')[0];
    if (bd) {
      // R-WARDEN-1: the Warden of the Deep comes with Lantern Delve's art; Ilvaris has her own.
      const warden = this.T.bestiaryBoss?.behaviour === 'warden';
      const hgt = warden ? DELVE_H.warden : 3.1;
      const s = this.makeSprite(warden ? this.tex(DELVE_ART.warden, true, true) : this.TEXS.eater, hgt);
      s.material.transparent = true; s.material.alphaTest = 0.02; s.material.depthWrite = false;
      E.boss = { def: bd, s, h: hgt, op: warden ? 1 : 0.2, flash: 0, hp: -1, deadT: -1 };
    }
    // torches: captive flames in iron cups
    const tor = this.byType('torch');
    E.torches = tor.map((t) => {
      const [i, j] = t.cell, [dx, dy] = SIDE[t.wall], fx = cx(i) + dx * S / 2, fz = cx(j) + dy * S / 2, nx = -dx, nz = -dy, y = 2.25;
      return { fx, fz, nx, nz, y, lx: fx + nx * 0.5, ly: y + 0.25, lz: fz + nz * 0.5, ph: i * 7.31 + j * 3.17, d: 0 };
    });
    if (tor.length) {
      const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.5, 0.07), M.iron, tor.length);
      const cup = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.06, 0.16, 8), M.iron, tor.length);
      const m4 = new THREE.Matrix4();
      E.torches.forEach((t, k) => {
        m4.makeTranslation(t.fx + t.nx * 0.1, t.y - 0.2, t.fz + t.nz * 0.1); arm.setMatrixAt(k, m4);
        m4.makeTranslation(t.fx + t.nx * 0.15, t.y + 0.06, t.fz + t.nz * 0.15); cup.setMatrixAt(k, m4);
        const sp = new THREE.Sprite(M.cold); sp.position.set(t.fx + t.nx * 0.16, t.y + 0.3, t.fz + t.nz * 0.16); this.world.add(sp); E.flames.push({ sp, ph: t.ph });
      });
      for (const im of [arm, cup]) { im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; this.world.add(im); }
    }
  }

  // ---------------------------------------------------------------- hands (Gloamhollow viewmodel)
  buildViewmodel() {
    this.vmScene = new THREE.Scene(); this.vmCam = new THREE.PerspectiveCamera(50, 1, 0.01, 10);
    this.vmScene.add(new THREE.AmbientLight(0xffe2c0, 0.22 * PI_L));
    this.vmLight = new THREE.PointLight(0xffc27c, 0.8 * PI_L, 6, 1.5); this.vmLight.position.set(-0.4, 0.1, -0.4); this.vmScene.add(this.vmLight);
    const VMM = (color, shin = 30, spec = 0x222222) => new THREE.MeshPhongMaterial({ color, shininess: shin, specular: spec });
    const sword = new THREE.Group(), lamp = new THREE.Group(), pole = new THREE.Group();
    const steel = VMM(0x8a9098, 60, 0x4a4a4a), brass = VMM(0xb48c42, 60, 0x553f1a), wrap = VMM(0x3b2a1e, 4), iron = VMM(0x2a2622, 30), wood = VMM(0x6b4a2b, 8);
    const add = (g, geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
    add(sword, new THREE.CylinderGeometry(0.024, 0.026, 0.18, 10), wrap, 0, 0, 0);
    add(sword, new THREE.SphereGeometry(0.038, 10, 8), brass, 0, -0.1, 0);
    add(sword, new THREE.BoxGeometry(0.22, 0.04, 0.06), brass, 0, 0.1, 0);
    add(sword, new THREE.BoxGeometry(0.06, 0.62, 0.016), steel, 0, 0.43, 0);
    add(sword, new THREE.BoxGeometry(0.043, 0.043, 0.016), steel, 0, 0.74, 0).rotation.z = Math.PI / 4;
    add(lamp, new THREE.BoxGeometry(0.17, 0.02, 0.17), iron, 0, 0.13, 0);
    add(lamp, new THREE.BoxGeometry(0.19, 0.03, 0.19), iron, 0, -0.12, 0);
    for (const [x, z] of [[-0.08, -0.08], [0.08, -0.08], [-0.08, 0.08], [0.08, 0.08]]) add(lamp, new THREE.BoxGeometry(0.018, 0.25, 0.018), iron, x, 0, z);
    add(lamp, new THREE.TorusGeometry(0.05, 0.008, 6, 12), iron, 0, 0.19, 0);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowFlame, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); core.scale.set(0.32, 0.36, 1); lamp.add(core);
    const sh = []; for (const s of [-1, 1]) { const p = new THREE.Group(); p.position.set(s * 0.085, 0, -0.088); add(p, new THREE.BoxGeometry(0.085, 0.22, 0.008), iron, -s * 0.0425, 0, 0); lamp.add(p); sh.push(p); }
    add(pole, new THREE.CylinderGeometry(0.018, 0.022, 3.2, 8), wood, 0, 0, 0).rotation.x = Math.PI / 2;
    pole.visible = false;
    sword.scale.setScalar(0.46); lamp.scale.setScalar(0.5); pole.scale.setScalar(0.55);
    this.vmScene.add(sword, lamp, pole);
    this.VM = { sword, lamp, pole, core, sh, t: 1, kind: 'swing', dur: 0.3, bob: 0 };
  }
  vmAnim(kind) { const V = this.VM; V.t = 0; V.kind = kind; V.dur = { swing: 0.32, probe: 0.6, toss: 0.34 }[kind] || 0.3; }

  // ---------------------------------------------------------------- feedback from sim events
  onEvent(ev, st) {
    if (ev.e === 'swing') this.vmAnim('swing');
    else if (ev.e === 'probe') this.vmAnim('probe');
    else if (ev.e === 'throw') this.vmAnim('toss');
    else if (ev.e === 'bell') { const b = this.E.bells.get(ev.id); if (b) b.swing = 1; }
    else if (ev.e === 'alcove') { const w = this.E.water.get(ev.id); if (w) { w.t = 0; w.m.visible = true; } }
    else if (ev.e === 'hurt') this.shake = Math.max(this.shake, 0.18);
    else if (ev.e === 'death') { this.sink = 0; this.fallV = 0; this.deathKind = ev.cause; if (ev.cause === 'slab') this.shake = 0.6; }
    else if (ev.e === 'rise') { this.sink = 0; this.fallV = 0; this.shake = 0; for (const w of this.E.water.values()) { w.t = -1; w.m.visible = false; } }
    else if (ev.e === 'hit') { const f = this.E.foes.find((x) => x.def.id === ev.id); if (f) f.flash = 0.16; else if (this.E.boss) { this.E.boss.flash = 0.2; this.shake = Math.max(this.shake, 0.1); } }
    else if (ev.e === 'land' && (ev.k === 'plate')) this.fallingSlab = true;
    void st;
  }

  // ---------------------------------------------------------------- per frame
  lightAt(x, y, z) {
    let b = (this.ambient.intensity / PI_L) * 0.6;
    const add = (l) => {
      if (l.intensity <= 0) return;
      const dx = l.position.x - x, dy = l.position.y - y, dz = l.position.z - z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < l.distance) b += (l.intensity / PI_L) * Math.pow(1 - d / l.distance, l.decay);
    };
    add(this.lantern); for (const p of this.torchPool) add(p.light); for (const l of this.fxPool) add(l);
    return Math.min(1.25, b);
  }

  /**
   * Draw one frame. st = the sim state now, prev = the state one tick earlier (for interpolation, alpha 0..1),
   * look = { yaw, pitch } radians from the client, info = derived facts from main.js.
   */
  frame(dt, st, prev, alpha, look, info) {
    this.time += dt;
    const t = this.time, E = this.E, M = this.M, P = st.player, Q = prev.player, w = this.T.w, red = this.reduced;
    const lerp = (a, b) => a + (b - a) * alpha;
    const px = lerp(Q.x, P.x) * MM, pz = lerp(Q.z, P.z) * MM;
    const speed = Math.hypot(P.vx, P.vz) * MM, dead = st.dead !== null;
    if (!dead) this.VM.bob += speed * dt * 2.3;
    // the static map follows the state
    E.doors.forEach((D, n) => { const k = D.grate ? 1 : -1, a = lerp(prev.doors[n].t, st.doors[n].t) / 693; D.mesh.position.y = D.h / 2 + k * D.h * 0.98 * easeOut(a); });
    for (const k of st.sprung) if (!this.slabMeshes.has(k)) {
      const i = k % w, j = (k / w) | 0, top = this.ceilOf[k];
      this.slabMeshes.set(k, { m: this.mesh(new THREE.BoxGeometry(S * 0.98, 0.55, S * 0.98), M.slab, cx(i), info.fresh ? 0.275 : top - 0.3, cx(j)), fall: !info.fresh, v: 0 });
    }
    for (const [k, s] of this.slabMeshes) if (!st.sprung.includes(k)) { this.world.remove(s.m); this.slabMeshes.delete(k); }
    for (const s of this.slabMeshes.values()) if (s.fall) { s.v += 26 * dt; s.m.position.y -= s.v * dt; if (s.m.position.y <= 0.275) { s.m.position.y = 0.275; s.fall = false; this.shake = Math.max(this.shake, 0.2); } }
    for (const k of st.marked) if (!this.xMeshes.has(k) && !st.sprung.includes(k)) { const i = k % w, j = (k / w) | 0, m = this.mesh(new THREE.PlaneGeometry(S * 0.7, S * 0.7), M.xmark, cx(i), 0.02, cx(j)); m.rotation.x = -Math.PI / 2; this.xMeshes.set(k, m); }
    for (const [k, m] of this.xMeshes) if (!st.marked.includes(k) || st.sprung.includes(k)) { this.world.remove(m); this.xMeshes.delete(k); }
    for (const [k, p] of this.pitMesh) { const open = st.pits.includes(k) || (this.alcoveAt.get(k)?.kind === 'tip' && info.sealedAlcoves.has(this.alcoveAt.get(k).id)); p.cover.visible = !open; p.shaft.visible = open; }
    for (const [k, b] of E.bridge) b.visible = st.bridge.includes(k);
    E.mirrors.forEach((m, n) => { const goal = st.mirrors[n] === 0 ? Math.PI / 4 : -Math.PI / 4; m.ang = m.ang === null || info.fresh ? goal : m.ang + (goal - m.ang) * Math.min(1, dt * 10); m.piv.rotation.y = m.ang; });
    E.hooks.forEach((h, n) => { h.lam.visible = P.hung === n; });
    E.chests.forEach((c, n) => { const open = st.chests[n].open; c.anim = open ? (info.fresh ? 1 : Math.min(1, c.anim + dt / 0.5)) : 0; c.lid.rotation.x = -1.9 * easeOut(c.anim); });
    E.braziers.forEach((b, n) => { b.f.material.opacity = st.braziers[n] ? 1 : 0; if (st.braziers[n]) { const s = red ? 1 : 1 + 0.1 * Math.sin(t * 12 + b.def.cell[0]); b.f.scale.set(1.2 * s, 1.6 * s, 1); } });
    for (const [id, it] of E.items) {
      const num = this.num.get(id), taken = st.taken.includes(num) || st.foes.some((f) => f.loot === num) || st.loot.some((l) => l.n === num), hidden = it.def.hidden && !st.revealed.includes(num);
      it.s.visible = it.rubble ? true : !taken && !hidden;
      if (!it.rubble && it.s.visible) { it.s.position.y = it.y + (red ? 0 : Math.sin(t * 2.2 + it.ph) * 0.05); it.s.material.color.setScalar(Math.max(0.5, this.lightAt(it.s.position.x, 0.4, it.s.position.z))); }
    }
    if (E.sarcLid) { const goal = st.boss && st.boss.st === 'dead' ? 1 : 0; E.lidT = info.fresh ? goal : goal ? Math.min(1, E.lidT + dt / 2.4) : 0; E.sarcLid.position.x = 1.2 * easeOut(E.lidT); E.sarcLid.rotation.y = 0.35 * easeOut(E.lidT); }
    if (E.day) { const on = info.exitOpen; E.day.visible = E.daySpr.visible = on; E.dayT = on ? (info.fresh ? 1 : Math.min(1, E.dayT + dt / 2)) : 0; E.day.material.opacity = 0.32 * E.dayT; E.daySpr.material.opacity = E.dayT; }
    for (const b of E.bells.values()) if (b.swing > 0) { b.swing = Math.max(0, b.swing - dt * 0.35); b.piv.rotation.z = Math.sin(t * 5.5) * 0.22 * b.swing; }
    for (const wv of E.water.values()) if (wv.t >= 0) {
      wv.t += dt; const up = Math.min(1, wv.t / 0.8), down = wv.t > 2.2 ? Math.min(1, (wv.t - 2.2) / 1.2) : 0, hh = 3.0 * up * (1 - down);
      wv.m.scale.y = Math.max(0.001, hh); wv.m.position.y = hh / 2; if (wv.t > 3.4) { wv.m.visible = false; wv.t = -1; }
    }
    // pebbles on the floor and in flight
    this.syncPebbles(st, prev, alpha);
    this.syncShots(st, alpha);
    this.syncLoot(st);
    // the mirror beam
    this.syncBeam(info.beam);
    // the tomb's own glows
    const tgt = info.lit ? 0 : 1;
    this.hoodMix += (tgt - this.hoodMix) * Math.min(1, dt * 5);
    const h15 = Math.pow(this.hoodMix, 1.4);
    M.mark.opacity = 0.95 * h15; M.ghost.opacity = 0.8 * h15; M.ghostKnown.opacity = 0.28 + 0.3 * h15;
    const wake = st.eyes.length ? Math.max(...st.eyes.map((m, n) => m / (5 * this.byType('eyes')[n].wake))) : 0;
    const lvl = wake < 0.04 ? 0 : wake < 0.55 ? 1 : 2;
    if (M.eye.map !== this.EYE_TEX[lvl]) { M.eye.map = this.EYE_TEX[lvl]; M.eye.needsUpdate = true; }
    for (const { g } of E.eyeGlows) g.material.opacity = 0.1 + wake * 0.9 * (red ? 1 : 0.85 + 0.15 * Math.sin(t * 20));
    E.vents.forEach((v) => {
      const s = info.vent(v.def);
      v.mesh.material.emissiveIntensity = s.s === 'warn' ? 0.25 + s.f * 1.1 : s.s === 'fire' ? 1.6 : 0.08;
      v.spr.forEach((sp, n) => { const on = s.s === 'fire'; sp.material.opacity = on ? 0.85 + 0.15 * Math.sin(t * 30 + n) : 0; if (on) { const k = Math.sin(s.f * Math.PI); sp.scale.set(1.1, 0.8 + 2.4 * k, 1); sp.position.y = 0.4 + 1.1 * k; } });
    });
    for (const c of E.crystals) { const hit = info.beam?.hits === c.def.id; M.crystal.emissiveIntensity = hit ? 1.6 : info.beamSolved ? 0.3 : 0; c.glow.material.opacity = hit ? 0.9 : 0; }
    for (const s of this.litSprites) s.material.color.setScalar(Math.max(0.3, this.lightAt(s.position.x, 0.5, s.position.z)));
    this.syncFoes(dt, st, prev, alpha, px, pz);
    this.syncBoss(dt, st, prev, alpha, px, pz, info);
    // camera
    if (dead) {
      const fall = this.deathKind === 'pit' || this.deathKind === 'chasm' || this.deathKind === 'tip';
      if (fall) { this.fallV += 14 * dt; this.sink += this.fallV * dt; } else this.sink = Math.min(1.25, this.sink + dt * (this.deathKind === 'slab' ? 6 : 1.1));
    }
    this.shake = Math.max(0, this.shake - dt);
    const sh = red ? 0 : this.shake * 0.18, rnd = () => (Math.random() - 0.5) * sh;
    const bob = red ? 0 : Math.sin(this.VM.bob * 2) * 0.035 * Math.min(1, speed / 3);
    const cam = this.camera;
    cam.position.set(px + rnd(), EYE + bob - this.sink + rnd(), pz + rnd());
    cam.rotation.set(look.pitch - (dead && this.fallV > 0 ? Math.min(0.9, this.sink * 0.1) : 0), look.yaw, dead && this.fallV === 0 ? Math.min(0.5, this.sink * 0.4) : 0);
    // the lantern
    const near = info.bossNear;
    this.starve += (near - this.starve) * Math.min(1, dt * 3);
    const fl = red ? 1 : 0.95 + 0.04 * Math.sin(t * 9.7) + 0.02 * Math.sin(t * 21.3);
    const L = this.lantern;
    if (P.hung >= 0) {
      const hk = E.hooks[P.hung]; L.position.set(hk.x + 0.15, 1.7, hk.z); L.intensity = 1.0 * fl * PI_L; L.distance = 8; this.ambient.intensity = 0.2 * PI_L;
    } else {
      const sy = Math.sin(look.yaw), cy = Math.cos(look.yaw), lit = P.oil > 0 && !P.doused ? 1 : 0, dimmed = 1 - 0.84 * this.hoodMix;
      L.position.set(px - sy * 0.35 - cy * 0.25, EYE - 0.3 - this.sink, pz - cy * 0.35 + sy * 0.25);
      L.intensity = (dead ? Math.max(0, 1.35 - this.sink) : 1.35) * fl * lit * (P.hooded || this.hoodMix > 0.01 ? dimmed : 1) * (1 - this.starve * 0.55) * PI_L;
      L.distance = 14 - 9 * (P.hooded ? this.hoodMix : 0) - 4 * this.starve;
      this.ambient.intensity = (0.3 - 0.24 * this.hoodMix) * PI_L;
    }
    this.updateTorches(t, px, pz);
    this.updateFxLights(t, st, px, pz, info);
    // draw
    const r = this.renderer;
    r.clear(); r.render(this.scene, cam);
    if (this.sink < 1 && !info.won) {
      this.updateViewmodel(dt, st, speed);
      this.vmLight.intensity = (0.15 + this.lightAt(px, EYE - 0.3, pz) * 0.5) * PI_L;
      r.clearDepth(); r.render(this.vmScene, this.vmCam);
    }
  }

  /** R-THIEF-4: loot dropped by killed thieves, as sprites where it lies. */
  syncLoot(st) {
    this.lootSprites ??= [];
    const key = st.loot.map((l) => `${l.x},${l.z},${l.n},${l.f},${l.p}`).join(';');
    if (key === this.lootKey) return;
    this.lootKey = key;
    for (const s of this.lootSprites) this.ents.remove(s);
    this.lootSprites = st.loot.map((l) => {
      const item = l.n > 0 ? this.T.gdf.entities[l.n - 1] : null, icon = item ? this.T.text.items?.[item.id]?.icon ?? 'coins' : null;
      const s = this.makeSprite(icon ? this.TEXS['i_' + icon] : l.f > 0 ? this.TEXS.i_flask : this.TEXS.rubble, l.p > 0 && !icon && l.f === 0 ? 0.12 : 0.3);
      s.position.set(l.x * MM, 0.12, l.z * MM); return s;
    });
  }

  syncPebbles(st, prev, alpha) {
    const want = st.floor.length;
    while (this.pebbles.length < want) this.pebbles.push(this.makeSprite(this.TEXS.rubble, 0.09));
    while (this.pebbles.length > want) this.ents.remove(this.pebbles.pop());
    st.floor.forEach((f, n) => {
      const k = Math.floor(f.z / 2400) * this.T.w + Math.floor(f.x / 2400), y = this.slabAt.has(k) || st.sprung.includes(k) ? 0.55 : 0;
      const s = this.pebbles[n]; s.position.set(f.x * MM, y, f.z * MM); s.material.color.setScalar(Math.max(0.35, this.lightAt(f.x * MM, 0.2, f.z * MM)));
    });
    // in flight: from the hand to where it lands, on an arc (Gloamhollow's toss), timed by the sim's landing tick
    for (const fl of this.flyers) fl.seen = false;
    for (const f of st.flying) {
      let fl = this.flyers.find((q) => q.at === f.at && q.x === f.x && q.z === f.z);
      if (!fl) {
        const P = st.player, yaw = yawRad(P.yaw), sx = P.x * MM - Math.sin(yaw) * 0.4, sz = P.z * MM - Math.cos(yaw) * 0.4;
        const d = Math.hypot(f.x * MM - sx, f.z * MM - sz);
        fl = { at: f.at, x: f.x, z: f.z, sx, sz, t0: st.tick, s: this.makeSprite(this.TEXS.rubble, 0.09), h: 0.6 + d * 0.1 };
        this.flyers.push(fl);
      }
      fl.seen = true;
      const u = clamp((st.tick - 1 + alpha - fl.t0) / Math.max(1, f.at - fl.t0), 0, 1);
      fl.s.position.set(fl.sx + (f.x * MM - fl.sx) * u, (EYE - 0.35) * (1 - u) + Math.sin(u * Math.PI) * fl.h, fl.sz + (f.z * MM - fl.sz) * u);
    }
    this.flyers = this.flyers.filter((fl) => { if (!fl.seen) this.ents.remove(fl.s); return fl.seen; });
    void prev;
  }

  /** R-SHOT-1: the shots in flight, drawn where they are between the last tick and this one. */
  syncShots(st, alpha) {
    const want = st.shots.length;
    while (this.shotSprites.length < want) {
      const sp = new THREE.Sprite(this.M.flame.clone());
      sp.material.opacity = 0.95; this.ents.add(sp); this.shotSprites.push(sp);
    }
    while (this.shotSprites.length > want) this.ents.remove(this.shotSprites.pop());
    st.shots.forEach((sh, n) => {
      const sp = this.shotSprites[n], back = (1 - alpha) * sh.sp / 30 * MM;      // it was a tick's flight behind
      const dx = sh.dx / 16384, dz = sh.dz / 16384, r = sh.r * MM;
      if (sp.userData.k !== sh.k) { sp.material.map = sh.k === 'fire' ? this.glowFlame : this.M.cold.map; sp.material.needsUpdate = true; sp.userData.k = sh.k; }
      sp.scale.set(r * 3.4, r * 3.4, 1);
      sp.position.set(sh.x * MM - dx * back, sh.k === 'fire' ? 1.5 : 1.6, sh.z * MM - dz * back);
    });
  }

  syncBeam(beam) {
    const E = this.E, key = beam ? beam.pts.map((p) => p.join(',')).join(';') : '';
    if (key === E.beamKey) return;
    E.beamKey = key;
    while (E.beam.children.length) { const c = E.beam.children.pop(); if (!c.isSprite) c.geometry.dispose(); }
    if (!beam) return;
    const pts = beam.pts;
    for (let s = 0; s < pts.length - 1; s++) {
      const [x0, z0] = pts[s], [x1, z1] = pts[s + 1], len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.01) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, len), this.M.beam); m.position.set((x0 + x1) / 2, 1.6, (z0 + z1) / 2); m.rotation.y = Math.atan2(x1 - x0, z1 - z0); E.beam.add(m);
      const halo = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, len), this.M.beam); halo.position.copy(m.position); halo.rotation.copy(m.rotation); halo.renderOrder = 1; E.beam.add(halo);
    }
    for (let s = 1; s < pts.length; s++) { const g = new THREE.Sprite(this.M.beamGlint); g.position.set(pts[s][0], 1.6, pts[s][1]); g.scale.setScalar(s === pts.length - 1 ? 0.9 : 1.3); E.beam.add(g); }
  }

  syncFoes(dt, st, prev, alpha, px, pz) {
    const t = this.time;
    this.E.foes.forEach((F, n) => {
      const f = st.foes[n], q = prev.foes[n], s = F.s;
      if (F.disg) F.disg.visible = f.st === 'disguised';
      if (f.st === 'dormant' || f.st === 'gone' || f.st === 'disguised') { s.visible = false; if (F.glow) F.glow.visible = false; F.deadT = -1; return; } // R-THIEF-3, R-MIMIC-1
      if (f.st === 'dead') {
        if (q.st !== 'dead' && F.deadT < 0) F.deadT = 0;
        if (F.deadT < 0 || F.deadT > 0.8) { s.visible = false; if (F.glow) F.glow.visible = false; return; }
        F.deadT += dt; s.material.opacity = Math.max(0, 1 - F.deadT / 0.7); s.position.y = -F.deadT * 0.4; if (F.glow) F.glow.visible = false; return;
      }
      F.deadT = -1; s.visible = true; s.material.opacity = 1; if (F.glow) F.glow.visible = true;
      const x = (q.x + (f.x - q.x) * alpha) * MM, z = (q.z + (f.z - q.z) * alpha) * MM;
      const kind = this.T.bestiary?.(F.def.kind);
      const riseT = kind?.rise ?? 39;
      if (f.st === 'rising') { s.position.set(x, -F.h * Math.max(0, f.t / Math.max(1, riseT)), z); s.material.color.setScalar(Math.max(F.min, this.lightAt(x, 0.9, z))); return; }
      F.flash = Math.max(0, F.flash - dt);
      const dx = px - x, dz = pz - z, d = Math.hypot(dx, dz) || 1;
      const wind = f.t > 0 && f.st === 'hunting' && kind ? f.t : 0;
      const lunge = wind ? (1 - wind / Math.max(1, kind.wind)) * 0.25 : 0;
      // Lantern Delve's fliers hover 0.7 m up and bob.
      const y = F.fly ? 0.7 + (this.reduced ? 0 : Math.sin(t * 3 + F.ph) * 0.12) : F.crawler ? Math.abs(Math.sin(t * 9 + F.ph)) * 0.04 : 0;
      s.position.set(x + dx / d * lunge, y, z + dz / d * lunge);
      const b = Math.max(F.min, this.lightAt(x, 0.9, z));
      if (F.flash > 0) s.material.color.setRGB(2.2, 0.8, 0.7); else if (wind) s.material.color.setRGB(b * 1.35, b * 1.1, b); else s.material.color.setScalar(b);
      if (f.st === 'asleep') s.material.color.setScalar(b * 0.8);
      // Spec §4.9.3: the phantom is invisible, but for a faint ghostlight while your lantern is dark.
      if (F.invisible) { s.material.opacity = 0.35 * this.hoodMix; s.material.color.setRGB(0.6, 0.85, 1.0); }
      if (F.glow) { F.glow.position.set(s.position.x, 0.42, s.position.z); F.glow.material.opacity = 0.5 + 0.2 * Math.sin(t * 3 + F.ph); }
    });
  }

  syncBoss(dt, st, prev, alpha, px, pz, info) {
    const B = this.E.boss; if (!B) return;
    const b = st.boss, q = prev.boss, s = B.s, t = this.time, img = s.material.map.image, ar = img.width / img.height;
    if (b.st === 'dead') {
      if (q.st !== 'dead' && B.deadT < 0) B.deadT = 0;
      if (B.deadT < 0 || B.deadT > 2) { s.visible = false; return; }
      B.deadT += dt; s.visible = true; s.material.opacity = Math.max(0, 1 - B.deadT / 1.8); s.position.y = B.deadT * 0.8; return;
    }
    B.deadT = -1; s.visible = true;
    const x = (q.x + (b.x - q.x) * alpha) * MM, z = (q.z + (b.z - q.z) * alpha) * MM;
    if (b.st === 'asleep') { s.material.opacity = 0.18 + 0.05 * Math.sin(t * 1.3); s.material.color.setScalar(0.5); s.position.set(x, -1.2, z); s.scale.set(B.h * ar * 0.9, B.h * 0.9, 1); return; }
    B.flash = Math.max(0, B.flash - dt);
    const goal = info.bossSolid ? 1 : 0.4 + 0.08 * Math.sin(t * 7) + 0.05 * Math.sin(t * 13.1);
    B.op += (goal - B.op) * Math.min(1, dt * 6); s.material.opacity = B.op;
    const dx = px - x, dz = pz - z, d = Math.hypot(dx, dz) || 1;
    const lunge = b.st === 'wind' ? (1 - b.t / Math.max(1, this.T.bestiaryBoss?.wind ?? 21)) * 0.35 : 0;
    s.position.set(x + dx / d * lunge, 0.05 * Math.sin(t * 2), z + dz / d * lunge); s.scale.set(B.h * ar, B.h, 1);
    const lb = Math.max(0.35, this.lightAt(x, 1.6, z));
    if (B.flash > 0) s.material.color.setRGB(2.4, 1.2, 0.9); else if (b.st === 'feed') s.material.color.setRGB(lb * 1.3, lb * 1.05, lb * 0.9); else s.material.color.setScalar(lb);
  }

  updateTorches(t, px, pz) {
    const T = this.E.torches, n = T.length, red = this.reduced;
    for (const f of this.E.flames) { const s = red ? 1 : 1 + 0.12 * Math.sin(t * 13 + f.ph) + 0.07 * Math.sin(t * 7.3 + f.ph * 2.1); f.sp.scale.set(0.42 * s, 0.64 * s, 1); }
    for (const tc of T) { const dx = tc.lx - px, dz = tc.lz - pz; tc.d = dx * dx + dz * dz; }
    const order = T.map((_, i) => i).sort((a, b) => T[a].d - T[b].d);
    const K = this.torchPool.length, top = order.slice(0, K), dCut = n > K ? Math.sqrt(T[order[K]].d) : 1e9, taken = new Set();
    for (const p of this.torchPool) { if (top.includes(p.torch)) taken.add(p.torch); else p.torch = -1; }
    for (const p of this.torchPool) if (p.torch === -1) { const free = top.find((i) => !taken.has(i)); if (free !== undefined) { p.torch = free; taken.add(free); } }
    for (const p of this.torchPool) {
      if (p.torch < 0) { p.light.intensity = 0; continue; }
      const tc = T[p.torch], d = Math.sqrt(tc.d), edge = clamp((dCut - d) / 2.5, 0, 1), far = clamp((26 - d) / 6, 0, 1);
      const fl = red ? 1 : 0.88 + 0.08 * Math.sin(t * 11.3 + tc.ph) + 0.04 * Math.sin(t * 23.1 + tc.ph * 1.7);
      p.light.intensity = 1.3 * edge * far * fl * PI_L; p.light.position.set(tc.lx, tc.ly, tc.lz);
    }
  }

  updateFxLights(t, st, px, pz, info) {
    const C = [], add = (x, y, z, col, int, dist) => C.push({ x, y, z, col, int, dist, d: Math.hypot(x - px, z - pz) }), red = this.reduced;
    this.E.braziers.forEach((b, n) => { if (st.braziers[n]) add(b.x, 1.7, b.z, 0xff9a46, 2.1 * (red ? 1 : 0.9 + 0.1 * Math.sin(t * 9 + n)), 11); });
    for (const v of this.E.vents) { const s = info.vent(v.def); if (s.s === 'fire') add(v.x, 1.0, v.z, 0xff7a2a, 2.8, 9); else if (s.s === 'warn') add(v.x, 0.4, v.z, 0xff5a1a, 1.1 * s.f, 6); }
    for (const c of this.E.crystals) if (info.beam?.hits === c.def.id) add(c.x, 1.7, c.z, 0xffd890, 1.8, 10);
    if (info.beam) { const e = info.beam.pts[info.beam.pts.length - 1]; add(e[0], 1.6, e[1], 0xffd890, 0.9, 4.5); }
    const b = st.boss; if (b && b.st !== 'asleep' && b.st !== 'dead') add(b.x * MM, 2.3, b.z * MM, 0xff8a3a, b.st === 'feed' ? 1.0 : 0.45, 5);
    const fs = st.shots.find((q) => q.k === 'fire'); if (fs) add(fs.x * MM, 1.5, fs.z * MM, 0xff8a3a, 1.4, 6); // R-SHOT-1: the breath lights the hall
    if (info.exitOpen && this.E.day) add(this.E.exitX, 4.5, this.E.exitZ, 0xfff2d8, 2.8, 16);
    C.sort((a, c) => a.d - c.d);
    this.fxPool.forEach((l, n) => { const c = C[n]; if (!c || c.d > 26) { l.intensity = 0; return; } l.position.set(c.x, c.y, c.z); l.color.setHex(c.col); l.intensity = c.int * PI_L; l.distance = c.dist; });
  }

  updateViewmodel(dt, st, speed) {
    const V = this.VM, red = this.reduced, P = st.player;
    V.t = Math.min(1, V.t + dt / V.dur);
    const moving = Math.min(1, speed / 3.5);
    const bx = red ? 0 : Math.sin(V.bob) * 0.014 * moving, by = red ? 0 : Math.abs(Math.cos(V.bob)) * 0.016 * moving;
    let px = 0.34 + bx, py = -0.33 + by, rx = -0.4, rz = 0.36;
    const pz = -0.8, ry = 0.15, lx = -0.3 - bx, ly = -0.24 + by * 0.6, lz = -0.74;
    V.pole.visible = false;
    if (V.t < 1) {
      const tt = V.t;
      if (V.kind === 'swing') {
        const up = tt < 0.25 ? tt / 0.25 : Math.max(0, 1 - (tt - 0.25) / 0.2);
        const sw = tt < 0.25 ? 0 : tt < 0.55 ? (tt - 0.25) / 0.3 : 1 - (tt - 0.55) / 0.45;
        rz += -0.5 * up + 1.25 * sw; rx += 0.15 * up - 0.7 * sw; px += 0.05 * up - 0.34 * sw; py += 0.08 * up - 0.12 * sw;
      } else if (V.kind === 'probe') {
        const f = tt < 0.4 ? tt / 0.4 : 1 - (tt - 0.4) / 0.6;
        V.pole.visible = true; V.pole.position.set(0.1, -0.32 + 0.04 * f, -1.0 - 1.1 * f); V.pole.rotation.set(-0.12, 0.04, 0);
        py -= 0.12 * f; px += 0.06 * f;
      } else if (V.kind === 'toss') {
        const f = tt < 0.35 ? tt / 0.35 : 1 - (tt - 0.35) / 0.65;
        py += 0.06 * f; rx -= 0.5 * f; px -= 0.06 * f;
      }
    }
    V.sword.position.set(px, py - this.sink * 0.6, pz); V.sword.rotation.set(rx, ry, rz);
    V.lamp.visible = P.hung < 0;
    V.lamp.position.set(lx, ly - this.sink * 0.6, lz); V.lamp.rotation.set(0.05, 0.3 + (red ? 0 : Math.sin(this.time * 1.7) * 0.03), red ? 0 : Math.sin(V.bob) * 0.04 * moving);
    const lit = P.oil > 0 && !P.doused ? 1 : 0; // R-POW-2: a doused lantern is dark
    V.sh[0].rotation.y = this.hoodMix * 1.45; V.sh[1].rotation.y = -this.hoodMix * 1.45;
    V.core.material.opacity = lit * (1 - 0.78 * this.hoodMix) * (0.92 + 0.08 * Math.sin(this.time * 9.7)) * (1 - this.starve * 0.6);
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.fov = w < h ? 80 : 72; this.camera.updateProjectionMatrix();
    this.vmCam.aspect = w / h; this.vmCam.fov = w < h ? 64 : 50; this.vmCam.updateProjectionMatrix();
  }
}
