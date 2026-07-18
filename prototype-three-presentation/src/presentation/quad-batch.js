import * as THREE from "three";

const DEFAULT_UV = Object.freeze({ u0: 0, v0: 0, u1: 1, v1: 1 });

export class QuadBatch {
  constructor(capacity, material, name) {
    this.capacity = capacity;
    this.count = 0;
    this.positions = new Float32Array(capacity * 12);
    this.uvs = new Float32Array(capacity * 8);
    this.colors = new Float32Array(capacity * 12);
    this.indices = new Uint16Array(capacity * 6);
    this.scratchColor = new THREE.Color();

    for (let index = 0; index < capacity; index += 1) {
      const vertex = index * 4;
      const offset = index * 6;
      this.indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], offset);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("uv", new THREE.BufferAttribute(this.uvs, 2));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));
    this.geometry.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
  }

  begin() { this.count = 0; }

  push({ x, y, width, height, z, uv = DEFAULT_UV, color = 0xffffff }) {
    if (this.count >= this.capacity) throw new Error(`${this.mesh.name} exceeded ${this.capacity} quads`);
    const index = this.count;
    const p = index * 12;
    const t = index * 8;
    const halfW = width / 2;
    const halfH = height / 2;
    const resolvedColor = this.scratchColor.set(color);

    this.positions.set([
      x - halfW, y - halfH, z,
      x + halfW, y - halfH, z,
      x + halfW, y + halfH, z,
      x - halfW, y + halfH, z,
    ], p);
    this.uvs.set([
      uv.u0, uv.v0,
      uv.u1, uv.v0,
      uv.u1, uv.v1,
      uv.u0, uv.v1,
    ], t);
    for (let vertex = 0; vertex < 4; vertex += 1) {
      this.colors.set([resolvedColor.r, resolvedColor.g, resolvedColor.b], p + vertex * 3);
    }
    this.count += 1;
  }

  finish() {
    this.geometry.setDrawRange(0, this.count * 6);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.uv.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
  }

  dispose() {
    this.geometry.dispose();
    this.mesh.material.dispose();
  }
}
