import { InstancedMesh, BufferGeometry, BufferAttribute, Mesh } from "./vendor/three.mjs";

// Call once after building the static scenery. Animated groups may still move,
// but individual meshes that need later updates must be explicitly excluded.
export function batchStaticMeshes(root, exclusions = new Set()) {
  const stats = { batches: 0, meshes: 0, drawCallsSaved: 0 };

  function visit(parent) {
    if (!parent.visible || exclusions.has(parent)) return;
    const groups = new Map();
    for (const child of [...parent.children]) {
      if (!child.visible || exclusions.has(child)) continue;
      if (child.isGroup) visit(child);
      if (
        !child.isMesh ||
        child.isInstancedMesh ||
        child.isSkinnedMesh ||
        child.children.length ||
        child.morphTargetInfluences ||
        child.customDepthMaterial ||
        child.customDistanceMaterial ||
        Array.isArray(child.material) ||
        !child.material ||
        (child.material.transparent && child.material.name !== 'tube-ribs') ||
        !child.material.visible
      )
        continue;
      if (child.matrixAutoUpdate) child.updateMatrix();
      // InstancedMesh cannot render reflected instance transforms correctly.
      if (child.matrix.determinant() <= 0) continue;
      const key = [
        child.geometry.id,
        child.material.id,
        child.castShadow,
        child.receiveShadow,
        child.renderOrder,
        child.layers.mask,
        child.frustumCulled,
      ].join(":");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(child);
    }
    for (const meshes of groups.values()) {
      if (meshes.length < 3) continue;
      const first = meshes[0];
      const batch = new InstancedMesh(
        first.geometry,
        first.material,
        meshes.length
      );
      batch.name = "Static scenery batch";
      batch.castShadow = first.castShadow;
      batch.receiveShadow = first.receiveShadow;
      batch.renderOrder = first.renderOrder;
      batch.layers.mask = first.layers.mask;
      batch.frustumCulled = first.frustumCulled;
      for (let i = 0; i < meshes.length; i++) {
        batch.setMatrixAt(i, meshes[i].matrix);
        parent.remove(meshes[i]);
      }
      batch.instanceMatrix.needsUpdate = true;
      batch.computeBoundingSphere();
      parent.add(batch);
      stats.batches++;
      stats.meshes += meshes.length;
      stats.drawCallsSaved += meshes.length - 1;
    }
  }

  visit(root);
  return stats;
}

/** Merge static facial curves with identical materials inside each animated rig. */
export function mergeStaticMeshes(root, exclusions = new Set()) {
  function visit(parent) {
    if (exclusions.has(parent)) return;
    const groups = new Map();
    for (const child of [...parent.children]) {
      if (exclusions.has(child) || !child.visible) continue;
      if (child.isGroup) visit(child);
      if (!child.isMesh || child.isInstancedMesh || child.children.length || Array.isArray(child.material) || child.material.transparent || child.geometry.morphAttributes.position) continue;
      const attributes = Object.keys(child.geometry.attributes).sort();
      if (!attributes.every(name => ['position', 'normal', 'uv'].includes(name))) continue;
      const key = [child.material.id, child.castShadow, child.receiveShadow, child.renderOrder, child.layers.mask, attributes.join(',')].join(':');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(child);
    }
    for (const meshes of groups.values()) {
      if (meshes.length < 2) continue;
      const first = meshes[0], names = Object.keys(first.geometry.attributes);
      const geometries = meshes.map(mesh => {
        mesh.updateMatrix();
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        return geometry.applyMatrix4(mesh.matrix);
      });
      const geometry = new BufferGeometry();
      for (const name of names) {
        const arrays = geometries.map(g => g.attributes[name].array);
        const data = new Float32Array(arrays.reduce((sum, a) => sum + a.length, 0));
        let offset = 0;
        for (const array of arrays) { data.set(array, offset); offset += array.length; }
        geometry.setAttribute(name, new BufferAttribute(data, first.geometry.attributes[name].itemSize));
      }
      const combined = new Mesh(geometry, first.material);
      combined.castShadow = first.castShadow; combined.receiveShadow = first.receiveShadow;
      combined.renderOrder = first.renderOrder; combined.layers.mask = first.layers.mask;
      meshes.forEach(mesh => parent.remove(mesh)); parent.add(combined);
      geometries.forEach(g => g.dispose());
    }
  }
  visit(root);
}
