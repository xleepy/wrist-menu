// THROWAWAY HITL UI PROTOTYPE. Rewrite any winning direction for production.

const variants = [
  { key: "A", name: "Command slab", eyebrow: "Scan first" },
  { key: "B", name: "Orbit halo", eyebrow: "Reach first" },
  { key: "C", name: "Thumb deck", eyebrow: "Priority first" },
];

const state = {
  tool: "Draw",
  snapGrid: true,
  comfort: false,
  objectCount: 3,
  lastAction: "Menu revealed",
};

const panel = document.querySelector("#wrist-panel");
const stateHud = document.querySelector("#state-hud");
const switcher = document.querySelector("#prototype-switcher");
const switcherLabel = document.querySelector("#switcher-label");
const switcherDots = document.querySelector("#switcher-dots");
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

function selectedVariant() {
  const key = new URLSearchParams(window.location.search).get("variant")?.toUpperCase();
  return variants.find((variant) => variant.key === key) || variants[0];
}

function renderHud() {
  stateHud.innerHTML = `
    <div class="state-hud__heading">
      <span class="live-pip"></span>
      <div><p>LIVE MENU STATE</p><strong>Visible · auto</strong></div>
    </div>
    <dl>
      <div><dt>Tool</dt><dd>${state.tool}</dd></div>
      <div><dt>Snap grid</dt><dd>${state.snapGrid ? "On" : "Off"}</dd></div>
      <div><dt>Comfort</dt><dd>${state.comfort ? "On" : "Off"}</dd></div>
      <div><dt>Objects</dt><dd>${state.objectCount}</dd></div>
      <div><dt>Motion</dt><dd>${motionQuery.matches ? "Reduced" : "Fluid"}</dd></div>
    </dl>
    <div class="state-event"><span>LAST</span><p>${state.lastAction}</p></div>
  `;
}

function optionButtons(className = "") {
  return ["Select", "Draw", "Teleport"]
    .map(
      (tool) => `
        <button type="button" class="${className} ${state.tool === tool ? "is-selected" : ""}"
          data-option="${tool}" aria-pressed="${state.tool === tool}">
          <span class="item-icon">${tool === "Select" ? "⌁" : tool === "Draw" ? "✦" : "⌖"}</span>
          <span>${tool}</span>
        </button>`,
    )
    .join("");
}

function toggleMarkup(label, key, icon, className = "menu-row") {
  const enabled = state[key];
  return `
    <button type="button" class="${className} ${enabled ? "is-on" : ""}" data-toggle="${key}"
      aria-pressed="${enabled}">
      <span class="item-icon">${icon}</span>
      <span class="item-copy"><strong>${label}</strong><small>${enabled ? "Enabled" : "Disabled"}</small></span>
      <span class="toggle-track"><i></i></span>
    </button>`;
}

function VariantA() {
  return `
    <article class="variant variant-a" aria-label="Variant A, command slab">
      <header class="slab-header">
        <div><span class="variant-kicker">A · SCAN FIRST</span><h1>Quick kit</h1></div>
        <span class="slab-status"><i></i>Ready</span>
      </header>
      <section class="slab-section">
        <p class="section-label"><span>01</span> ACTIVE TOOL</p>
        <div class="tool-segments">${optionButtons("tool-segment")}</div>
      </section>
      <div class="panel-separator"><span>SCENE</span></div>
      <section class="slab-grid">
        <button type="button" class="menu-row menu-row--action" data-action="spawn">
          <span class="item-icon">＋</span><span class="item-copy"><strong>Spawn cube</strong><small>Place at cursor</small></span>
          <span class="row-trailing">${String(state.objectCount).padStart(2, "0")}</span>
        </button>
        ${toggleMarkup("Snap grid", "snapGrid", "⌗")}
        ${toggleMarkup("Comfort", "comfort", "◒")}
        <button type="button" class="menu-row" data-action="reset">
          <span class="item-icon">↺</span><span class="item-copy"><strong>Reset world</strong><small>Restore defaults</small></span>
          <span class="row-chevron">›</span>
        </button>
      </section>
      <button type="button" class="disabled-row" disabled>
        <span>⊘</span><strong>Clear selection</strong><small>No object selected</small>
      </button>
      <footer class="slab-footer"><span>18 × 13 CM</span><span>6 TARGETS · 14 MM MIN</span></footer>
    </article>`;
}

function VariantB() {
  return `
    <article class="variant variant-b" aria-label="Variant B, orbit halo">
      <div class="orbit-title"><span>B · REACH FIRST</span><strong>Orbit kit</strong></div>
      <div class="orbit-rings" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="orbit-tools" aria-label="Tool choices">${optionButtons("orbit-choice")}</div>
      <button type="button" class="orbit-node orbit-node--spawn" data-action="spawn">
        <span class="orbit-icon">＋</span><strong>Spawn</strong><small>${state.objectCount} in scene</small>
      </button>
      <button type="button" class="orbit-node orbit-node--grid ${state.snapGrid ? "is-on" : ""}" data-toggle="snapGrid" aria-pressed="${state.snapGrid}">
        <span class="orbit-icon">⌗</span><strong>Grid</strong><small>${state.snapGrid ? "On" : "Off"}</small>
      </button>
      <button type="button" class="orbit-node orbit-node--comfort ${state.comfort ? "is-on" : ""}" data-toggle="comfort" aria-pressed="${state.comfort}">
        <span class="orbit-icon">◒</span><strong>Comfort</strong><small>${state.comfort ? "On" : "Off"}</small>
      </button>
      <button type="button" class="orbit-node orbit-node--reset" data-action="reset">
        <span class="orbit-icon">↺</span><strong>Reset</strong><small>World</small>
      </button>
      <div class="orbit-hub">
        <span class="hub-pulse"></span>
        <p>CURRENT TOOL</p><strong>${state.tool}</strong><small>Pinch a node</small>
      </div>
      <div class="orbit-separator" aria-label="Separator"></div>
      <button type="button" class="orbit-disabled" disabled><span>⊘</span> Clear selection</button>
      <div class="orbit-measure"><span>22 CM ARC</span><span>RADIAL · 16 MM MIN</span></div>
    </article>`;
}

function VariantC() {
  return `
    <article class="variant variant-c" aria-label="Variant C, thumb deck">
      <header class="deck-header">
        <div><span>C · PRIORITY FIRST</span><h1>Thumb deck</h1></div>
        <div class="deck-counter"><span>OBJECTS</span><strong>${String(state.objectCount).padStart(2, "0")}</strong></div>
      </header>
      <section class="deck-body">
        <div class="deck-tool-rail" aria-label="Tool choices">
          <p>TOOL</p>${optionButtons("deck-choice")}
        </div>
        <button type="button" class="deck-primary" data-action="spawn">
          <span class="deck-primary__halo"></span>
          <span class="deck-primary__icon">＋</span>
          <strong>Spawn cube</strong><small>At cursor</small>
        </button>
        <div class="deck-side-actions">
          <button type="button" class="deck-reset" data-action="reset"><span>↺</span><strong>Reset</strong><small>World</small></button>
          <button type="button" class="deck-disabled" disabled><span>⊘</span><strong>Clear</strong><small>Unavailable</small></button>
        </div>
      </section>
      <div class="deck-divider"><span>ENVIRONMENT</span></div>
      <section class="deck-rockers">
        ${toggleMarkup("Snap grid", "snapGrid", "⌗", "deck-rocker")}
        ${toggleMarkup("Comfort", "comfort", "◒", "deck-rocker")}
      </section>
      <footer class="deck-footer"><span>20 × 12 CM</span><span>THUMB ZONE · 15 MM MIN</span></footer>
    </article>`;
}

function render() {
  const current = selectedVariant();
  document.documentElement.dataset.variant = current.key;
  panel.innerHTML = current.key === "A" ? VariantA() : current.key === "B" ? VariantB() : VariantC();
  switcherLabel.textContent = `${current.key} — ${current.name}`;
  switcherDots.innerHTML = variants
    .map((variant) => `<span class="${variant.key === current.key ? "is-active" : ""}"></span>`)
    .join("");
  renderHud();
}

function cycle(direction) {
  const currentIndex = variants.findIndex((variant) => variant.key === selectedVariant().key);
  const next = variants[(currentIndex + direction + variants.length) % variants.length];
  const url = new URL(window.location.href);
  url.searchParams.set("variant", next.key);
  window.history.replaceState({}, "", url);
  render();
}

panel.addEventListener("click", (event) => {
  const control = event.target.closest("button");
  if (!control || control.disabled) return;

  if (control.dataset.option) {
    state.tool = control.dataset.option;
    state.lastAction = `${state.tool} tool selected`;
  }

  if (control.dataset.toggle) {
    const key = control.dataset.toggle;
    state[key] = !state[key];
    state.lastAction = `${key === "snapGrid" ? "Snap grid" : "Comfort"} ${state[key] ? "enabled" : "disabled"}`;
  }

  if (control.dataset.action === "spawn") {
    state.objectCount += 1;
    state.lastAction = `Cube ${String(state.objectCount).padStart(2, "0")} spawned`;
  }

  if (control.dataset.action === "reset") {
    state.tool = "Select";
    state.snapGrid = true;
    state.comfort = false;
    state.objectCount = 0;
    state.lastAction = "World reset";
  }

  render();
});

// Prototype-only route gate keeps the evaluator switcher out of any other page.
if (window.location.pathname.startsWith("/prototype/wrist-panel")) {
  switcher.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cycle]");
    if (button) cycle(Number(button.dataset.cycle));
  });

  window.addEventListener("keydown", (event) => {
    const tag = event.target.tagName;
    if (["INPUT", "TEXTAREA"].includes(tag) || event.target.isContentEditable) return;
    if (event.key === "ArrowLeft") cycle(-1);
    if (event.key === "ArrowRight") cycle(1);
  });
}

window.addEventListener("popstate", render);
motionQuery.addEventListener("change", renderHud);
render();
