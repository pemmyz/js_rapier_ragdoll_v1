import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import RAPIER from "@dimforge/rapier3d-compat";

// ---------- Three.js Setup ----------
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b0f16, 10, 55);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 4, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 2, 0);

const hemi = new THREE.HemisphereLight(0x9bbcff, 0x0b0f16, 0.9);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 1.1);
dir.position.set(8, 12, 6);
dir.castShadow = true;
dir.shadow.mapSize.width = 2048;
dir.shadow.mapSize.height = 2048;
scene.add(dir);

const groundMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.8 });
const groundGeo = new THREE.BoxGeometry(40, 1, 40);
const groundMesh = new THREE.Mesh(groundGeo, groundMat);
groundMesh.position.y = -0.5;
groundMesh.receiveShadow = true;
scene.add(groundMesh);

// ---------- Rapier Setup ----------
await RAPIER.init();

const gravity = { x: 0, y: -9.81, z: 0 };
const world = new RAPIER.World(gravity);

// Ground physics
{
  const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setFriction(1.0), rb);
}

// ---------- Helpers ----------
const meshToBody = new Map();
const bodyToMesh = new Map();

function addDynamicCapsule(radius, halfHeight, x, y, z, color) {
  // Added damping to naturally slow things down
  const rbDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .setLinearDamping(0.5)
    .setAngularDamping(0.5);

  const rb = world.createRigidBody(rbDesc);

  const colDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius)
    .setDensity(1.0)
    .setFriction(0.8)
    .setRestitution(0.2);

  world.createCollider(colDesc, rb);

  const geo = new THREE.CapsuleGeometry(radius, halfHeight * 2, 8, 16);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  scene.add(mesh);

  meshToBody.set(mesh, rb);
  bodyToMesh.set(rb.handle, mesh);

  return { rb, mesh };
}

function addDynamicBox(hx, hy, hz, x, y, z, color) {
  const rbDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .setLinearDamping(0.5)
    .setAngularDamping(0.5);

  const rb = world.createRigidBody(rbDesc);

  const colDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
    .setDensity(1.0)
    .setFriction(0.8)
    .setRestitution(0.2);

  world.createCollider(colDesc, rb);

  const geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  scene.add(mesh);

  meshToBody.set(mesh, rb);
  bodyToMesh.set(rb.handle, mesh);

  return { rb, mesh };
}

// ---------- Ragdoll ----------
const parts = {};
parts.torso = addDynamicCapsule(0.25, 0.35, 0, 3.0, 0, 0x60a5fa);
parts.pelvis = addDynamicBox(0.30, 0.15, 0.15, 0, 2.3, 0, 0x3b82f6);
parts.head = addDynamicCapsule(0.18, 0.05, 0, 3.8, 0, 0xfbbf24);
parts.uarmL = addDynamicCapsule(0.10, 0.25, -0.60, 3.15, 0, 0x93c5fd);
parts.larmL = addDynamicCapsule(0.09, 0.25, -1.00, 2.85, 0, 0x93c5fd);
parts.uarmR = addDynamicCapsule(0.10, 0.25, 0.60, 3.15, 0, 0x93c5fd);
parts.larmR = addDynamicCapsule(0.09, 0.25, 1.00, 2.85, 0, 0x93c5fd);
parts.ulegL = addDynamicCapsule(0.12, 0.30, -0.25, 1.7, 0, 0x2563eb);
parts.llegL = addDynamicCapsule(0.11, 0.30, -0.25, 0.9, 0, 0x2563eb);
parts.ulegR = addDynamicCapsule(0.12, 0.30, 0.25, 1.7, 0, 0x2563eb);
parts.llegR = addDynamicCapsule(0.11, 0.30, 0.25, 0.9, 0, 0x2563eb);

// Helper: Spherical Joint (Free rotation for hips/shoulders)
function spherical(a, b, anchorA, anchorB) {
  const params = RAPIER.JointData.spherical(anchorA, anchorB);
  return world.createImpulseJoint(params, a, b, true);
}

// Helper: Revolute Joint with Limits (Hinge for elbows/knees)
function revolute(a, b, anchorA, anchorB, minAngle, maxAngle) {
  // Rotation axis: X-axis ({x:1, y:0, z:0})
  const axis = { x: 1, y: 0, z: 0 };
  const params = RAPIER.JointData.revolute(anchorA, anchorB, axis);
  // Enables joint limits
  params.limitsEnabled = true;
  params.limits = [minAngle, maxAngle];
  return world.createImpulseJoint(params, a, b, true);
}

// --- Joints Configuration ---

// Spine & Head
spherical(parts.torso.rb, parts.pelvis.rb, { x: 0, y: -0.45, z: 0 }, { x: 0, y: 0.20, z: 0 });
spherical(parts.torso.rb, parts.head.rb, { x: 0, y: 0.45, z: 0 }, { x: 0, y: -0.15, z: 0 });

// Shoulders
spherical(parts.torso.rb, parts.uarmL.rb, { x: -0.35, y: 0.25, z: 0 }, { x: 0, y: 0.30, z: 0 });
spherical(parts.torso.rb, parts.uarmR.rb, { x: 0.35, y: 0.25, z: 0 }, { x: 0, y: 0.30, z: 0 });

// Elbows (Hinge, 0 to 2.5 rads)
revolute(parts.uarmL.rb, parts.larmL.rb, { x: 0, y: -0.30, z: 0 }, { x: 0, y: 0.30, z: 0 }, 0, 2.5);
revolute(parts.uarmR.rb, parts.larmR.rb, { x: 0, y: -0.30, z: 0 }, { x: 0, y: 0.30, z: 0 }, 0, 2.5);

// Hips
spherical(parts.pelvis.rb, parts.ulegL.rb, { x: -0.20, y: -0.15, z: 0 }, { x: 0, y: 0.35, z: 0 });
spherical(parts.pelvis.rb, parts.ulegR.rb, { x: 0.20, y: -0.15, z: 0 }, { x: 0, y: 0.35, z: 0 });

// Knees (Hinge, -2.5 to 0 rads)
revolute(parts.ulegL.rb, parts.llegL.rb, { x: 0, y: -0.35, z: 0 }, { x: 0, y: 0.35, z: 0 }, -2.5, 0);
revolute(parts.ulegR.rb, parts.llegR.rb, { x: 0, y: -0.35, z: 0 }, { x: 0, y: 0.35, z: 0 }, -2.5, 0);

// ---------- FIXED DRAG SYSTEM ----------
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();

let dragging = false;
let draggedBody = null;
let dragJoint = null;
// A kinematic body that follows the mouse cursor
const dragHandleRB = world.createRigidBody(
  RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 100, 0)
);
world.createCollider(RAPIER.ColliderDesc.ball(0.01).setSensor(true), dragHandleRB);

const dragPlane = new THREE.Plane();
const dragHit = new THREE.Vector3();

function getMouse(e) {
  const r = renderer.domElement.getBoundingClientRect();
  mouseNDC.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  mouseNDC.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
}

function startDrag(e) {
  getMouse(e);
  raycaster.setFromCamera(mouseNDC, camera);
  const meshes = [...meshToBody.keys()];
  const hits = raycaster.intersectObjects(meshes, false);

  if (!hits.length) return;
  const hit = hits[0];
  const mesh = hit.object;
  const body = meshToBody.get(mesh);
  if (!body) return;

  controls.enabled = false;
  // Create a plane perpendicular to camera direction to drag along
  dragPlane.setFromNormalAndCoplanarPoint(
    camera.getWorldDirection(new THREE.Vector3()).negate(),
    hit.point
  );
  dragHandleRB.setNextKinematicTranslation(hit.point);

  const localAnchor = mesh.worldToLocal(hit.point.clone());
  const params = RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, localAnchor);
  params.stiffness = 1.0;
  params.damping = 1.0;

  dragJoint = world.createImpulseJoint(params, dragHandleRB, body, true);
  body.wakeUp();
  draggedBody = body;
  dragging = true;
}

function moveDrag(e) {
  if (!dragging) return;
  getMouse(e);
  raycaster.setFromCamera(mouseNDC, camera);
  if (raycaster.ray.intersectPlane(dragPlane, dragHit)) {
    dragHandleRB.setNextKinematicTranslation(dragHit);
    draggedBody.wakeUp();
  }
}

function endDrag() {
  controls.enabled = true;
  if (!dragging) return;
  if (dragJoint) {
    world.removeImpulseJoint(dragJoint, true);
  }
  dragJoint = null;
  draggedBody = null;
  dragging = false;
}

window.addEventListener('pointerdown', (e) => {
  if (e.button === 0) startDrag(e);
});
window.addEventListener('pointermove', moveDrag);
window.addEventListener('pointerup', endDrag);

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- Loop ----------
const qTmp = new THREE.Quaternion();

// Max Speeds (Fixes "far too high speed" during drag/collision)
const MAX_LINEAR_VELOCITY = 10.0;
const MAX_ANGULAR_VELOCITY = 15.0;

function animate() {
  requestAnimationFrame(animate);
  world.step();

  for (const [handle, mesh] of bodyToMesh.entries()) {
    const rb = world.getRigidBody(handle);
    if (!rb) continue;

    // --- SPEED CLAMPING ---
    // This ensures joints don't explode when dragged too hard
    const lin = rb.linvel();
    const ang = rb.angvel();

    // Clamp Linear Velocity
    const lLenSq = lin.x * lin.x + lin.y * lin.y + lin.z * lin.z;
    if (lLenSq > MAX_LINEAR_VELOCITY * MAX_LINEAR_VELOCITY) {
      const scale = MAX_LINEAR_VELOCITY / Math.sqrt(lLenSq);
      rb.setLinvel({ x: lin.x * scale, y: lin.y * scale, z: lin.z * scale }, true);
    }

    // Clamp Angular Velocity
    const aLenSq = ang.x * ang.x + ang.y * ang.y + ang.z * ang.z;
    if (aLenSq > MAX_ANGULAR_VELOCITY * MAX_ANGULAR_VELOCITY) {
      const scale = MAX_ANGULAR_VELOCITY / Math.sqrt(aLenSq);
      rb.setAngvel({ x: ang.x * scale, y: ang.y * scale, z: ang.z * scale }, true);
    }
    // ----------------------

    const t = rb.translation();
    const r = rb.rotation();
    mesh.position.set(t.x, t.y, t.z);
    qTmp.set(r.x, r.y, r.z, r.w);
    mesh.quaternion.copy(qTmp);
  }

  controls.update();
  renderer.render(scene, camera);
}

animate();
