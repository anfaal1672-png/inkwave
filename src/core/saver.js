// saver quality: strip the MeshPhysicalMaterial extras (clearcoat, sheen, iridescence, transmission) — each adds
// per-pixel lighting work; with all of them 0 three.js compiles the plain standard path. Originals are kept in
// userData so leaving saver restores them. Materials flagged userData.keepCoat are skipped: the level's ink shader
// (world/inkShading.js) writes material.clearcoat itself and reads clearcoatRadiance, which only exist while
// USE_CLEARCOAT is defined.
const KEYS = ['clearcoat', 'sheen', 'iridescence', 'transmission'];
export function applyPlainMaterials(root, on) {
  root.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : null;
    if (!ms) return;
    for (const m of ms) {
      if (!m.isMeshPhysicalMaterial || m.userData.keepCoat) continue;
      const u = m.userData;
      if (on) {
        if (!u._plain) { u._plain = {}; for (const k of KEYS) u._plain[k] = m[k]; }
        let ch = false;
        for (const k of KEYS) if (m[k] !== 0) { m[k] = 0; ch = true; }
        if (ch) m.needsUpdate = true;
      } else if (u._plain) {
        for (const k of KEYS) m[k] = u._plain[k];
        u._plain = null; m.needsUpdate = true;
      }
    }
  });
}
