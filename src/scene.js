import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// All geometry, textures and lighting in this scene are generated in the browser.
const FINISHES = {
  sand: { body: '#b5a58d', trim: '#494b43' },
  forest: { body: '#546354', trim: '#303d34' },
  charcoal: { body: '#484b49', trim: '#272e2b' },
  clay: { body: '#a47461', trim: '#523f36' },
  chalk: { body: '#d9d8cc', trim: '#686b60' },
};
const FLOOR = 0.36;
const HEIGHT = 2.8;
const ROOF = FLOOR + HEIGHT;
const BAY = 1.5;

export function createScene(container, { onBayClick, onReady, onError } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  } catch (error) {
    const note = document.createElement('p');
    note.className = 'scene-fallback';
    note.textContent = 'This device cannot show the 3D preview. Use the configuration controls to edit and export your design.';
    container.append(note);
    onError?.(error);
    return { update() {}, setView() {}, setRoofOpen() {}, setDimensions() {}, setSelectedBay() {}, capture: () => null, dispose: () => note.remove() };
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const canvas = renderer.domElement;
  canvas.className = 'configurator-canvas';
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.setAttribute('aria-label', 'Interactive 3D model. Drag to rotate, scroll to zoom, click a facade bay to edit.');
  canvas.setAttribute('role', 'img');
  canvas.tabIndex = 0;
  container.append(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#eaece5');
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.05, 250);
  camera.position.set(10, 9, 13);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.11;
  controls.minPolarAngle = 0.02;
  controls.maxPolarAngle = Math.PI / 2 - 0.025;
  controls.enablePan = false;
  controls.minZoom = 0.55;
  controls.maxZoom = 3;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.7;
  controls.target.set(0, 1.3, 0);
  controls.update();

  scene.add(new THREE.HemisphereLight('#f8fbf3', '#8a8b79', 3));
  const sun = new THREE.DirectionalLight('#fff3d8', 4.3);
  sun.position.set(-8, 13, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 45 });
  sun.shadow.normalBias = 0.03;
  sun.shadow.bias = -0.00015;
  sun.shadow.radius = 4;
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#d5e4ed', 1.25);
  fill.position.set(9, 7, -10);
  scene.add(fill);

  const groundGeometry = new THREE.PlaneGeometry(200, 200);
  const groundMaterial = new THREE.MeshStandardMaterial({ color: '#eaece5', roughness: 1 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.035;
  ground.receiveShadow = true;
  scene.add(ground);

  let building = new THREE.Group();
  let roofGroup = new THREE.Group();
  let dimensions = new THREE.Group();
  let selection = new THREE.Group();
  let hitTargets = [];
  let config = { length: 6, modules: 1, color: 'forest', front: ['window', 'door', 'window', 'wall'], rear: ['wall', 'window', 'window', 'wall'], furniture: true, deck: true };
  let roofOpen = false;
  let showDimensions = false;
  let selectedBay = null;
  let disposed = false;
  let raf = 0;
  let inFrame = false;
  let remainingFrames = 0;
  let view = 'iso';
  let cameraTween = null;
  scene.add(building, dimensions, selection);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let press = null;

  function material(color, extra = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });
  }

  function box(parent, x, y, z, width, height, depth, mat, { shadow = true } = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function cylinder(parent, x, y, z, radius, height, mat, sides = 16) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, sides), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function disposeGroup(group) {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    group.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      const mats = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const mat of mats) {
        materials.add(mat);
        if (mat.map) textures.add(mat.map);
      }
    });
    geometries.forEach((item) => item.dispose());
    materials.forEach((item) => item.dispose());
    textures.forEach((item) => item.dispose());
    group.clear();
  }

  function woodTexture() {
    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = 256;
    textureCanvas.height = 256;
    const ctx = textureCanvas.getContext('2d');
    ctx.fillStyle = '#bda27a';
    ctx.fillRect(0, 0, 256, 256);
    // Deterministic fine grain: no photos, business assets or random exported data.
    for (let i = 0; i < 160; i++) {
      const y = (i * 31.7) % 256;
      ctx.strokeStyle = i % 3 === 0 ? 'rgba(90,64,36,.13)' : 'rgba(251,230,191,.15)';
      ctx.lineWidth = (i % 3 + 1) * 0.35;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(70, y - 3, 185, y + 3, 256, y + (i % 5 - 2));
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 2);
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return texture;
  }

  function cladding(parent, x, bottom, z, width, height, depth, bodyMat, ribMat, axis = 'x') {
    if (width <= 0.001 || height <= 0.001 || depth <= 0.001) return;
    box(parent, x, bottom + height / 2, z, width, height, depth, bodyMat);
    // Fine standing seams give the metal a readable scale even at the default zoom.
    const span = axis === 'x' ? width : depth;
    const count = Math.max(1, Math.floor(span / 0.15));
    for (let i = 1; i < count; i++) {
      const offset = -span / 2 + (i * span) / count;
      if (axis === 'x') {
        box(parent, x + offset, bottom + height / 2, z + Math.sign(z || 1) * depth / 2, 0.012, height, 0.018, ribMat, { shadow: false });
      } else {
        box(parent, x + Math.sign(x || 1) * width / 2, bottom + height / 2, z + offset, 0.018, height, 0.012, ribMat, { shadow: false });
      }
    }
  }

  function makeFacade(side, types, length, width, mats) {
    const sign = side === 'front' ? 1 : -1;
    const z = sign * width / 2;
    const wallThickness = 0.13;
    const count = length / BAY;
    for (let index = 0; index < count; index++) {
      const x = -length / 2 + BAY * (index + 0.5);
      const type = types?.[index] || 'wall';
      if (type === 'wall') {
        cladding(building, x, FLOOR, z, BAY, HEIGHT, wallThickness, mats.body, mats.rib);
      } else {
        const openingWidth = type === 'door' ? 1.03 : 1.24;
        const sill = type === 'door' ? 0 : 0.78;
        const openingHeight = type === 'door' ? 2.34 : 1.65;
        const jambWidth = (BAY - openingWidth) / 2;
        cladding(building, x - BAY / 2 + jambWidth / 2, FLOOR, z, jambWidth, HEIGHT, wallThickness, mats.body, mats.rib);
        cladding(building, x + BAY / 2 - jambWidth / 2, FLOOR, z, jambWidth, HEIGHT, wallThickness, mats.body, mats.rib);
        cladding(building, x, FLOOR, z, openingWidth, sill, wallThickness, mats.body, mats.rib);
        cladding(building, x, FLOOR + sill + openingHeight, z, openingWidth, HEIGHT - sill - openingHeight, wallThickness, mats.body, mats.rib);
        const frameZ = z + sign * 0.045;
        const frame = 0.055;
        const openingY = FLOOR + sill;
        box(building, x - openingWidth / 2 + frame / 2, openingY + openingHeight / 2, frameZ, frame, openingHeight, 0.17, mats.trim);
        box(building, x + openingWidth / 2 - frame / 2, openingY + openingHeight / 2, frameZ, frame, openingHeight, 0.17, mats.trim);
        box(building, x, openingY + openingHeight - frame / 2, frameZ, openingWidth, frame, 0.17, mats.trim);
        box(building, x, openingY + frame / 2, frameZ, openingWidth, frame, 0.19, mats.trim);
        const glass = box(building, x, openingY + openingHeight / 2, z, openingWidth - frame * 2, openingHeight - frame * 2, 0.018, mats.glass, { shadow: false });
        glass.renderOrder = 2;
        if (type === 'window') {
          // A single slender mullion and an outside sill are enough to read as an actual window.
          box(building, x, openingY + openingHeight / 2, frameZ, 0.028, openingHeight - frame * 2, 0.06, mats.trim);
          box(building, x, openingY - 0.025, z + sign * 0.07, openingWidth + 0.08, 0.045, 0.25, mats.trim);
        } else {
          box(building, x + openingWidth * 0.31, openingY + 1.08, z + sign * 0.15, 0.028, 0.28, 0.035, mats.handle);
          box(building, x, openingY + 0.12, z + sign * 0.03, openingWidth - 0.12, 0.15, 0.04, mats.trim);
        }
      }
      const proxy = box(building, x, FLOOR + HEIGHT / 2, z + sign * 0.16, BAY - 0.03, HEIGHT - 0.04, 0.025, mats.hit, { shadow: false });
      proxy.receiveShadow = false;
      proxy.userData = { facade: side, index };
      hitTargets.push(proxy);
    }
  }

  function addDesk(x, z, mats, facing = 1) {
    const group = new THREE.Group();
    group.position.set(x, FLOOR, z);
    group.rotation.y = facing < 0 ? Math.PI : 0;
    building.add(group);
    box(group, 0, 0.76, 0, 1.45, 0.055, 0.7, mats.wood);
    for (const dx of [-0.61, 0.61]) {
      box(group, dx, 0.37, 0, 0.045, 0.74, 0.5, mats.furnitureMetal);
      box(group, dx, 0.025, 0, 0.075, 0.05, 0.63, mats.furnitureMetal);
    }
    box(group, 0.1, 1.11, -0.14, 0.58, 0.34, 0.035, mats.furnitureMetal);
    box(group, 0.1, 1.11, -0.115, 0.52, 0.285, 0.008, mats.screen);
    box(group, 0.1, 0.85, -0.14, 0.04, 0.16, 0.04, mats.furnitureMetal);
    box(group, 0.1, 0.8, -0.14, 0.24, 0.015, 0.16, mats.furnitureMetal);
    box(group, 0.05, 0.795, 0.16, 0.36, 0.018, 0.125, mats.keyboard);
    // An upholstered task chair, with a visible five-star style base.
    box(group, 0, 0.48, 0.77, 0.45, 0.09, 0.44, mats.fabric);
    const back = box(group, 0, 0.77, 0.98, 0.43, 0.48, 0.07, mats.fabric);
    back.rotation.x = -0.1;
    cylinder(group, 0, 0.24, 0.77, 0.035, 0.4, mats.furnitureMetal);
    for (let i = 0; i < 5; i++) {
      const arm = box(group, 0, 0.06, 0.77, 0.57, 0.025, 0.035, mats.furnitureMetal);
      arm.rotation.y = i * Math.PI * 2 / 5;
    }
    cylinder(group, -0.51, 0.83, -0.1, 0.065, 0.11, mats.paper);
  }

  function addPlant(parent, x, z, mats, scale = 1) {
    const group = new THREE.Group();
    group.position.set(x, FLOOR, z);
    group.scale.setScalar(scale);
    parent.add(group);
    cylinder(group, 0, 0.19, 0, 0.16, 0.38, mats.pot);
    const stem = cylinder(group, 0, 0.65, 0, 0.017, 0.75, mats.leaf);
    stem.castShadow = false;
    for (let i = 0; i < 9; i++) {
      const angle = i * 2.4;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mats.leaf);
      leaf.scale.set(0.11, 0.29, 0.045);
      leaf.position.set(Math.cos(angle) * 0.15, 0.58 + i * 0.052, Math.sin(angle) * 0.15);
      leaf.rotation.set(0.4, angle, Math.cos(angle) * 0.9);
      leaf.castShadow = true;
      group.add(leaf);
    }
  }

  function build() {
    scene.remove(building, dimensions, selection);
    disposeGroup(building);
    disposeGroup(dimensions);
    disposeGroup(selection);
    building = new THREE.Group();
    dimensions = new THREE.Group();
    selection = new THREE.Group();
    roofGroup = new THREE.Group();
    hitTargets = [];
    scene.add(building, dimensions, selection);
    const length = config.length === 9 ? 9 : 6;
    const modules = Math.max(1, Math.min(3, Number(config.modules) || 1));
    const width = modules * 3;
    const finish = FINISHES[config.color] || FINISHES.forest;
    const mats = {
      body: material(finish.body, { metalness: 0.32, roughness: 0.57 }),
      rib: material(new THREE.Color(finish.body).multiplyScalar(0.87), { metalness: 0.35, roughness: 0.56 }),
      trim: material(finish.trim, { metalness: 0.58, roughness: 0.43 }),
      handle: material('#bdc5bd', { metalness: 0.9, roughness: 0.23 }),
      roof: material('#dee0d6', { metalness: 0.4, roughness: 0.61 }),
      base: material('#414a42', { metalness: 0.42, roughness: 0.6 }),
      pad: material('#bcbcaf'),
      wood: material('#ffffff', { map: woodTexture(), roughness: 0.82 }),
      floor: material('#d5c6a5', { roughness: 0.88 }),
      glass: new THREE.MeshPhysicalMaterial({ color: '#bad0c7', roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
      furnitureMetal: material('#3d4641', { metalness: 0.4, roughness: 0.55 }),
      screen: material('#a8c1ad', { emissive: '#799f8b', emissiveIntensity: 0.25, roughness: 0.4 }),
      keyboard: material('#d4d4c7'),
      fabric: material('#83947c', { roughness: 1 }),
      paper: material('#f4f0e4'),
      leaf: material('#527352', { roughness: 0.9 }),
      pot: material('#b2856c', { roughness: 0.95 }),
      wallInside: material('#e7e5d9', { roughness: 0.95 }),
      hit: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false }),
    };

    // Separate pads, base frame and floor make the object read as a manufacturable module.
    for (let m = 0; m < modules; m++) {
      const z = -width / 2 + 1.5 + m * 3;
      for (const x of [-length / 2 + 0.27, 0, length / 2 - 0.27]) {
        for (const dz of [-1.24, 1.24]) {
          box(building, x, 0.065, z + dz, 0.47, 0.13, 0.47, mats.pad);
          box(building, x, 0.2, z + dz, 0.21, 0.14, 0.21, mats.base);
        }
      }
      box(building, 0, 0.265, z, length + 0.06, 0.17, 3.04, mats.base);
      box(building, 0, FLOOR - 0.013, z, length - 0.13, 0.04, 2.88, mats.floor);
      // Fine floorboard lines and staggered joints remain readable in roof-open mode.
      for (let i = 0; i < 16; i++) {
        const lineZ = z - 1.4 + i * 0.18;
        box(building, 0, FLOOR + 0.01, lineZ, length - 0.2, 0.003, 0.008, mats.wood, { shadow: false });
      }
      const roof = box(roofGroup, 0, ROOF + 0.075, z, length + 0.18, 0.15, 3.12, mats.roof);
      roof.receiveShadow = true;
      box(roofGroup, 0, ROOF + 0.02, z + 1.54, length + 0.2, 0.18, 0.065, mats.trim);
      box(roofGroup, 0, ROOF + 0.02, z - 1.54, length + 0.2, 0.18, 0.065, mats.trim);
      for (let i = 0; i < 6; i++) {
        box(roofGroup, 0, ROOF + 0.155, z - 1.25 + i * 0.5, length + 0.08, 0.014, 0.02, mats.roof, { shadow: false });
      }
      // Warm flush interior lighting is visible with the roof lifted out of the way.
      for (const x of [-length * 0.25, length * 0.25]) {
        box(roofGroup, x, ROOF - 0.055, z, 1.35, 0.035, 0.12, mats.paper, { shadow: false });
      }
    }
    building.add(roofGroup);
    roofGroup.visible = !roofOpen;

    makeFacade('front', config.front, length, width, mats);
    makeFacade('rear', config.rear, length, width, mats);
    for (const sign of [-1, 1]) {
      cladding(building, sign * length / 2, FLOOR, 0, 0.13, HEIGHT, width, mats.body, mats.rib, 'z');
      box(building, sign * (length / 2 + 0.015), ROOF - 0.07, 0, 0.17, 0.18, width + 0.1, mats.trim);
      for (let m = 0; m <= modules; m++) {
        const z = -width / 2 + m * 3;
        box(building, sign * length / 2, FLOOR + HEIGHT / 2, z, 0.19, HEIGHT + 0.04, 0.14, mats.trim);
      }
    }
    for (const sign of [-1, 1]) {
      box(building, 0, ROOF - 0.07, sign * (width / 2 + 0.015), length + 0.18, 0.18, 0.17, mats.trim);
      box(building, 0, FLOOR + 0.045, sign * (width / 2 + 0.015), length + 0.16, 0.09, 0.17, mats.trim);
    }

    if (config.deck) {
      const deckDepth = 1.45;
      const z = width / 2 + deckDepth / 2 + 0.09;
      box(building, 0, 0.19, z, length + 0.08, 0.22, deckDepth, mats.base);
      for (let i = 0; i < 10; i++) {
        box(building, 0, 0.315, width / 2 + 0.12 + i * 0.145, length + 0.12, 0.05, 0.136, mats.wood);
      }
      box(building, -length / 2 + 0.65, 0.085, width / 2 + 1.72, 1.2, 0.17, 0.38, mats.wood);
    }

    if (config.partition) {
      // A real passage remains open in this internal partition, rather than a solid slab.
      const opening = 1.05;
      const wallSpan = (width - opening) / 2;
      for (const sign of [-1, 1]) {
        box(building, length * 0.15, FLOOR + HEIGHT / 2, sign * (opening / 2 + wallSpan / 2), 0.085, HEIGHT - 0.06, wallSpan, mats.wallInside);
      }
      box(building, length * 0.15, FLOOR + 2.57, 0, 0.085, 0.4, opening, mats.wallInside);
      for (const sign of [-1, 1]) {
        box(building, length * 0.15, FLOOR + 1.18, sign * (opening / 2), 0.1, 2.36, 0.04, mats.trim);
      }
    }

    if (config.furniture) {
      for (let m = 0; m < modules; m++) {
        const z = -width / 2 + m * 3 + 1.5;
        addDesk(-length * 0.26, z - 0.3, mats);
        if (length === 9) addDesk(length * 0.26, z - 0.3, mats);
      }
      // One small communal table keeps the six-metre option useful without overcrowding.
      if (length === 6) {
        const tableZ = -width / 2 + 1.5;
        cylinder(building, length * 0.3, FLOOR + 0.75, tableZ, 0.48, 0.06, mats.wood, 32);
        cylinder(building, length * 0.3, FLOOR + 0.37, tableZ, 0.065, 0.74, mats.furnitureMetal);
        cylinder(building, length * 0.3, FLOOR + 0.04, tableZ, 0.32, 0.05, mats.furnitureMetal, 24);
        for (const sign of [-1, 1]) {
          box(building, length * 0.3, FLOOR + 0.45, tableZ + sign * 0.71, 0.43, 0.075, 0.43, mats.fabric);
          box(building, length * 0.3, FLOOR + 0.7, tableZ + sign * 0.91, 0.43, 0.42, 0.06, mats.fabric);
          for (const dx of [-0.16, 0.16]) box(building, length * 0.3 + dx, FLOOR + 0.22, tableZ + sign * 0.71, 0.035, 0.44, 0.3, mats.furnitureMetal);
        }
      }
      addPlant(building, length / 2 - 0.48, width / 2 - 0.49, mats, 1.1);
      addPlant(building, -length / 2 + 0.46, -width / 2 + 0.45, mats, 0.75);
    }
    addDimensions(length, width);
    updateSelection();
    dimensions.visible = showDimensions;
    frameCamera(false);
    requestRender(3);
  }

  function makeLabel(text, x, y, z) {
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 512;
    labelCanvas.height = 128;
    const ctx = labelCanvas.getContext('2d');
    ctx.fillStyle = '#f5f5ee';
    ctx.beginPath();
    ctx.roundRect(5, 10, 502, 108, 26);
    ctx.fill();
    ctx.fillStyle = '#38483f';
    ctx.font = '600 52px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 65);
    const texture = new THREE.CanvasTexture(labelCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
    sprite.position.set(x, y, z);
    sprite.scale.set(1.24, 0.31, 1);
    sprite.renderOrder = 10;
    dimensions.add(sprite);
  }

  function dimensionLine(a, b) {
    const lineMat = new THREE.LineBasicMaterial({ color: '#76867a', transparent: true, opacity: 0.85, depthTest: false });
    const vectorA = new THREE.Vector3(...a);
    const vectorB = new THREE.Vector3(...b);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([vectorA, vectorB]), lineMat);
    line.renderOrder = 8;
    dimensions.add(line);
    const difference = vectorB.clone().sub(vectorA).normalize();
    const tick = Math.abs(difference.y) > 0.5 ? new THREE.Vector3(0.13, 0, 0) : new THREE.Vector3(0, 0.12, 0);
    for (const point of [vectorA, vectorB]) {
      const end = new THREE.Line(new THREE.BufferGeometry().setFromPoints([point.clone().sub(tick), point.clone().add(tick)]), lineMat);
      end.renderOrder = 8;
      dimensions.add(end);
    }
  }

  function addDimensions(length, width) {
    const z = width / 2 + (config.deck ? 2.08 : 0.7);
    dimensionLine([-length / 2, 0.04, z], [length / 2, 0.04, z]);
    makeLabel(`${length},00 m`, 0, 0.12, z + 0.14);
    dimensionLine([length / 2 + 0.63, 0.04, -width / 2], [length / 2 + 0.63, 0.04, width / 2]);
    makeLabel(`${width},00 m`, length / 2 + 0.78, 0.15, 0);
    dimensionLine([-length / 2 - 0.46, FLOOR, -width / 2 - 0.1], [-length / 2 - 0.46, ROOF, -width / 2 - 0.1]);
    makeLabel('2,80 m', -length / 2 - 0.53, FLOOR + HEIGHT / 2, -width / 2 - 0.12);
  }

  function updateSelection() {
    disposeGroup(selection);
    if (!selectedBay) return;
    const { facade, index } = selectedBay;
    const count = config.length / BAY;
    if (!['front', 'rear'].includes(facade) || index < 0 || index >= count) return;
    const sign = facade === 'front' ? 1 : -1;
    const x = -config.length / 2 + BAY * (index + 0.5);
    const z = sign * (config.modules * 1.5 + 0.19);
    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(BAY - 0.1, HEIGHT - 0.12, 0.035));
    const outline = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#e7b773', depthTest: false }));
    outline.position.set(x, FLOOR + HEIGHT / 2, z);
    outline.renderOrder = 9;
    selection.add(outline);
    requestRender();
  }

  function fitFrustum() {
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    const aspect = width / height;
    camera.updateMatrixWorld();
    const length = config.length;
    const depth = config.modules * 3;
    const zExtra = config.deck ? 1.85 : 0.25;
    const margin = showDimensions ? 0.9 : 0.22;
    let halfHeight = 0;
    for (const x of [-length / 2 - margin, length / 2 + margin]) {
      for (const y of [0, ROOF + 0.25]) {
        for (const z of [-depth / 2 - margin, depth / 2 + zExtra + margin]) {
          const point = new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
          halfHeight = Math.max(halfHeight, Math.abs(point.y), Math.abs(point.x) / aspect);
        }
      }
    }
    halfHeight *= 1.09;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  }

  function frameCamera(animate = false) {
    const center = new THREE.Vector3(0, 1.25, config.deck ? 0.45 : 0);
    const length = config.length;
    const width = config.modules * 3;
    const offset = view === 'front' ? new THREE.Vector3(0, 1.05, 18) : view === 'top' ? new THREE.Vector3(0, 22, 0.01) : new THREE.Vector3(length * 0.95 + 2, 8 + width * 0.36, width * 0.84 + 8);
    const position = center.clone().add(offset);
    if (animate) {
      cameraTween = { started: performance.now(), from: camera.position.clone(), targetFrom: controls.target.clone(), to: position, targetTo: center };
      requestRender(40);
    } else {
      cameraTween = null;
      camera.position.copy(position);
      controls.target.copy(center);
      camera.zoom = 1;
      camera.lookAt(center);
      controls.update();
      fitFrustum();
    }
  }

  function render(time) {
    raf = 0;
    if (disposed) return;
    inFrame = true;
    if (cameraTween) {
      const t = Math.min(1, (time - cameraTween.started) / 450);
      const eased = 1 - (1 - t) ** 3;
      camera.position.lerpVectors(cameraTween.from, cameraTween.to, eased);
      controls.target.lerpVectors(cameraTween.targetFrom, cameraTween.targetTo, eased);
      camera.lookAt(controls.target);
      if (t >= 1) cameraTween = null;
      fitFrustum();
    }
    controls.update();
    renderer.render(scene, camera);
    inFrame = false;
    remainingFrames = Math.max(0, remainingFrames - 1);
    if (remainingFrames || cameraTween) raf = requestAnimationFrame(render);
  }

  function requestRender(frames = 1) {
    if (disposed) return;
    remainingFrames = Math.max(remainingFrames, frames);
    if (!raf && !inFrame) raf = requestAnimationFrame(render);
  }

  const onControlChange = () => requestRender(12);
  const onControlStart = () => { cameraTween = null; requestRender(20); };
  controls.addEventListener('change', onControlChange);
  controls.addEventListener('start', onControlStart);

  function getHit(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(hitTargets, false);
    return hits.find((hit) => {
      const sign = hit.object.userData.facade === 'front' ? 1 : -1;
      return (camera.position.z - sign * config.modules * 1.5) * sign > 0;
    });
  }

  function pointerDown(event) {
    if (event.button === 0 || event.pointerType === 'touch') press = { x: event.clientX, y: event.clientY, id: event.pointerId, time: performance.now() };
  }
  function pointerUp(event) {
    if (!press || press.id !== event.pointerId) return;
    const isClick = Math.hypot(press.x - event.clientX, press.y - event.clientY) < 6 && performance.now() - press.time < 650;
    press = null;
    if (!isClick) return;
    const hit = getHit(event);
    if (hit) {
      const { facade, index } = hit.object.userData;
      selectedBay = { facade, index };
      updateSelection();
      onBayClick?.(facade, index);
    }
  }
  function pointerMove(event) {
    if (!press && event.pointerType !== 'touch') canvas.style.cursor = getHit(event) ? 'pointer' : 'grab';
  }
  function pointerCancel() { press = null; }
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointercancel', pointerCancel);

  const resizeObserver = new ResizeObserver(() => { fitFrustum(); requestRender(); });
  resizeObserver.observe(container);
  build();
  requestAnimationFrame(() => { if (!disposed) onReady?.(); });

  return {
    update(next) { config = { ...config, ...next }; build(); },
    setView(next) { if (!['iso', 'front', 'top'].includes(next)) return; view = next; camera.zoom = 1; frameCamera(true); },
    setRoofOpen(open) { roofOpen = Boolean(open); roofGroup.visible = !roofOpen; requestRender(); },
    setDimensions(show) { showDimensions = Boolean(show); dimensions.visible = showDimensions; fitFrustum(); requestRender(); },
    setSelectedBay(facade, index) {
      selectedBay = facade && typeof facade === 'object' ? facade : facade ? { facade, index } : null;
      updateSelection();
    },
    capture() { controls.update(); renderer.render(scene, camera); return canvas.toDataURL('image/png'); },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      controls.removeEventListener('change', onControlChange);
      controls.removeEventListener('start', onControlStart);
      controls.dispose();
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointercancel', pointerCancel);
      disposeGroup(building);
      disposeGroup(dimensions);
      disposeGroup(selection);
      groundGeometry.dispose();
      groundMaterial.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
