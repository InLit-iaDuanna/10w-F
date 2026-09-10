// @ts-nocheck
/*
 * SceneOps Forge · Neumorphic interaction runtime
 *
 * The runtime is deliberately DOM-oriented. It observes Dockview and module
 * surfaces after the existing product logic creates them, so the visual
 * interaction layer never replaces the command bus, editor registry, layout
 * persistence, or business state.
 *
 * Physical invariants:
 * - the illuminant remains fixed at the top-left;
 * - elevation changes shadow magnitude, never shadow direction;
 * - a pointer approaching a control occludes light, so hover shadows contract;
 * - button pressure becomes inset instead of translating the button;
 * - panel projection/scale is permitted only while a workframe changes depth;
 * - all scripted motion is critically damped: no bounce, spring overshoot, or glow.
 */

export const NEUMORPHIC_INTERACTION_MODES = Object.freeze({
  SURFACE: 'surface-extrusion',
  EDGE: 'edge-extrusion',
  STACK: 'depth-stack',
});

export const NEUMORPHIC_INTERACTION_MODE_LIST = Object.freeze([
  NEUMORPHIC_INTERACTION_MODES.SURFACE,
  NEUMORPHIC_INTERACTION_MODES.EDGE,
  NEUMORPHIC_INTERACTION_MODES.STACK,
]);

const MODE_ALIASES = Object.freeze({
  surface: NEUMORPHIC_INTERACTION_MODES.SURFACE,
  membrane: NEUMORPHIC_INTERACTION_MODES.SURFACE,
  pop: NEUMORPHIC_INTERACTION_MODES.SURFACE,
  edge: NEUMORPHIC_INTERACTION_MODES.EDGE,
  drawer: NEUMORPHIC_INTERACTION_MODES.EDGE,
  dock: NEUMORPHIC_INTERACTION_MODES.EDGE,
  stack: NEUMORPHIC_INTERACTION_MODES.STACK,
  depth: NEUMORPHIC_INTERACTION_MODES.STACK,
  spatial: NEUMORPHIC_INTERACTION_MODES.STACK,
});

const FRAME_SELECTOR = [
  '[data-neu-workframe]',
  '.dv-floating-box',
  '.dv-groupview',
  '.forge-area-menu',
  '.forge-window-options',
  '.forge-restore-notice',
  '.unified-ai-provider-dialog',
  '.debug-panel',
  '[role="dialog"]',
].join(',');

const STACK_FRAME_SELECTOR = [
  '[data-neu-workframe]',
  '.dv-floating-box',
  '.dv-groupview',
  '.unified-ai-provider-dialog',
  '.debug-panel',
  '[role="dialog"]',
].join(',');

const SOURCE_SELECTOR = [
  'button',
  '[role="button"]',
  'summary',
  '.dv-tab',
  '.forge-edge-handle',
  '[data-neu-open-source]',
].join(',');

const TAB_SELECTOR = '.dv-tab, [role="tab"], [data-neu-tab]';
const EDGE_SELECTOR = '.forge-edge-handle, [data-neu-edge]';
const DEPTH_SURFACE_ATTRIBUTE = 'data-neu-depth-surface';
const FRAME_ATTRIBUTE = 'data-neu-frame-mounted';
const ACTIVE_ATTRIBUTE = 'data-neu-active-frame';
const ENTERING_ATTRIBUTE = 'data-neu-entering';
const REVEALING_ATTRIBUTE = 'data-neu-revealing';
const PRESSING_ATTRIBUTE = 'data-neu-pressing';

const DEFAULT_OPTIONS = Object.freeze({
  mode: NEUMORPHIC_INTERACTION_MODES.EDGE,
  frameSelector: FRAME_SELECTOR,
  sourceSelector: SOURCE_SELECTOR,
  sourceLifetimeMs: 1600,
  surfaceDurationMs: 560,
  edgeDurationMs: 430,
  stackDurationMs: 520,
  tabDurationMs: 260,
  tiltDegreesX: 0.52,
  tiltDegreesY: 0.72,
  debug: false,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());
const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function normalizeMode(value, fallback = String(DEFAULT_OPTIONS.mode)) {
  if (!value) return fallback;
  if (NEUMORPHIC_INTERACTION_MODE_LIST.includes(value)) return value;
  return MODE_ALIASES[String(value).toLowerCase()] ?? fallback;
}

function safeClosest(target, selector) {
  if (!(target instanceof Element)) return null;
  try {
    return target.closest(selector);
  } catch {
    return null;
  }
}

function elementRect(element) {
  if (!(element instanceof Element) || !element.isConnected) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
    x: rect.x,
    y: rect.y,
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2,
  };
}

function edgeFromElement(element) {
  if (!(element instanceof Element)) return null;
  const declared = element.getAttribute('data-neu-edge');
  if (['left', 'right', 'top', 'bottom'].includes(declared)) return declared;
  if (element.matches('.forge-edge-left')) return 'left';
  if (element.matches('.forge-edge-right')) return 'right';
  if (element.matches('.forge-edge-top')) return 'top';
  if (element.matches('.forge-edge-bottom')) return 'bottom';
  return null;
}

function edgeFromPlacement(placement) {
  if (!placement || typeof placement !== 'object') return null;
  if (placement.mode === 'drawer' && ['left', 'right', 'top', 'bottom'].includes(placement.edge)) return placement.edge;
  if (placement.mode === 'split') {
    if (placement.direction === 'above') return 'top';
    if (placement.direction === 'below') return 'bottom';
    if (placement.direction === 'left' || placement.direction === 'right') return placement.direction;
  }
  return null;
}

function inferEntryEdge(source, target) {
  if (source?.edge) return source.edge;
  const placementEdge = edgeFromPlacement(source?.placement);
  if (placementEdge) return placementEdge;
  if (source?.rect) {
    const dx = target.centerX - source.rect.centerX;
    const dy = target.centerY - source.rect.centerY;
    if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? 'left' : 'right';
    return dy >= 0 ? 'top' : 'bottom';
  }
  const distances = {
    left: target.left,
    right: Math.max(0, window.innerWidth - target.right),
    top: target.top,
    bottom: Math.max(0, window.innerHeight - target.bottom),
  };
  return Object.entries(distances).sort((a, b) => a[1] - b[1])[0]?.[0] ?? 'left';
}

function clipForEdge(edge, amount = 100) {
  const pct = clamp(amount, 0, 100);
  switch (edge) {
    case 'right': return `inset(0 0 0 ${pct}% round 18px)`;
    case 'top': return `inset(0 0 ${pct}% 0 round 18px)`;
    case 'bottom': return `inset(${pct}% 0 0 0 round 18px)`;
    case 'left':
    default: return `inset(0 ${pct}% 0 0 round 18px)`;
  }
}

function rootStyles() {
  const root = getComputedStyle(document.documentElement);
  const read = (name, fallback) => root.getPropertyValue(name).trim() || fallback;
  return {
    base: read('--neu-base', '#e0e5ec'),
    ink: read('--neu-ink', '#465064'),
    accent: read('--neu-accent', '#6d5dfc'),
    accentInk: read('--neu-accent-ink', '#5140d8'),
    shadowDark: read('--neu-shadow-dark', '#b8bcc2'),
    shadowLight: read('--neu-shadow-light', '#ffffff'),
    raised: read('--neu-raised', '8px 8px 16px #b8bcc2, -8px -8px 16px #ffffff'),
    raisedLg: read('--neu-raised-lg', '10px 10px 24px #b8bcc2, -10px -10px 24px #ffffff'),
    raisedSm: read('--neu-raised-sm', '5px 5px 10px #b8bcc2, -5px -5px 10px #ffffff'),
    hover: read('--neu-hover', '4px 4px 8px #b8bcc2, -4px -4px 8px #ffffff'),
    inset: read('--neu-inset', 'inset 6px 6px 12px #b8bcc2, inset -6px -6px 12px #ffffff'),
    insetSm: read('--neu-inset-sm', 'inset 4px 4px 8px #b8bcc2, inset -4px -4px 8px #ffffff'),
    insetXs: read('--neu-inset-xs', 'inset 2px 2px 4px #b8bcc2, inset -2px -2px 4px #ffffff'),
  };
}

function isFrameVisible(frame) {
  if (!(frame instanceof HTMLElement) || !frame.isConnected) return false;
  const style = getComputedStyle(frame);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = frame.getBoundingClientRect();
  return rect.width > 16 && rect.height > 16;
}

function resolveMotionSurface(frame) {
  if (!(frame instanceof HTMLElement)) return frame;
  if (frame.matches('.dv-floating-box')) {
    return frame.querySelector('.dv-groupview') ?? frame.firstElementChild ?? frame;
  }
  if (frame.matches('dialog') && frame.firstElementChild instanceof HTMLElement) {
    return frame;
  }
  return frame;
}

function topLevelFrames(frames) {
  const list = [...new Set(frames)].filter(frame => frame instanceof HTMLElement);
  return list.filter(frame => !list.some(candidate => candidate !== frame && candidate.contains(frame)));
}

function collectFrames(node, selector) {
  if (!(node instanceof Element)) return [];
  const frames = [];
  if (node.matches(selector)) frames.push(node);
  frames.push(...node.querySelectorAll(selector));
  return topLevelFrames(frames);
}

function safeAnimate(element, keyframes, options) {
  if (!(element instanceof Element) || typeof element.animate !== 'function') return null;
  try {
    return element.animate(keyframes, options);
  } catch {
    return null;
  }
}

function animationFinished(animation) {
  if (!animation) return Promise.resolve();
  return animation.finished.catch(() => undefined);
}

function formatSource(source) {
  if (!source) return 'screen';
  if (source.edge) return `edge:${source.edge}`;
  const label = source.element?.getAttribute?.('aria-label') || source.element?.textContent?.trim?.();
  return label ? `control:${label.slice(0, 28)}` : 'control';
}

export class NeumorphicInteractionController {
  constructor(root, options = {}) {
    if (!(root instanceof HTMLElement)) {
      throw new TypeError('NeumorphicInteractionController requires an HTMLElement root.');
    }
    this.root = root;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.mode = normalizeMode(this.options.mode);
    this.lastSource = null;
    this.pressSource = null;
    this.pendingFrames = new WeakSet();
    this.tiltFrame = 0;
    this.tiltSurface = null;
    this.tiltPoint = null;
    this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.finePointerQuery = window.matchMedia('(pointer: fine)');
    this.observer = new MutationObserver(records => this.onMutations(records));
    this.abortController = new AbortController();
    this.mounted = false;
  }

  mount() {
    if (this.mounted) return this;
    this.mounted = true;
    this.setMode(this.mode, { persist: false, announce: false });
    this.markExistingFrames();

    const signal = this.abortController.signal;
    this.root.addEventListener('pointerdown', event => this.onPointerDown(event), { capture: true, signal });
    this.root.addEventListener('click', event => this.onClick(event), { capture: true, signal });
    this.root.addEventListener('pointermove', event => this.onPointerMove(event), { passive: true, signal });
    this.root.addEventListener('pointerover', event => this.onPointerOver(event), { passive: true, signal });
    this.root.addEventListener('pointerout', event => this.onPointerOut(event), { passive: true, signal });
    this.root.addEventListener('toggle', event => this.onToggle(event), { capture: true, signal });
    window.addEventListener('pointerup', event => this.onPointerRelease(event), { passive: true, signal });
    window.addEventListener('pointercancel', event => this.onPointerRelease(event), { passive: true, signal });
    window.addEventListener('blur', () => this.releasePressure(), { signal });
    window.addEventListener('sceneops:neumorphic-open-source', event => this.onExternalSource(event), { signal });
    window.addEventListener('sceneops:neumorphic-activate-frame', event => this.onExternalActivation(event), { signal });
    window.addEventListener('sceneops:neumorphic-close-frame', event => this.onExternalClose(event), { signal });

    this.observer.observe(this.root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open', 'aria-hidden', 'hidden', 'style'],
    });

    this.root.setAttribute('data-neu-interactions-ready', 'true');
    this.log('mounted', { mode: this.mode });
    return this;
  }

  destroy() {
    if (!this.mounted) return;
    this.mounted = false;
    this.abortController.abort();
    this.observer.disconnect();
    cancelAnimationFrame(this.tiltFrame);
    this.releasePressure();
    this.clearTilt();
    this.root.removeAttribute('data-neu-interactions-ready');
    delete document.documentElement.dataset.neuInteraction;
    this.log('destroyed');
  }

  setMode(value, options = {}) {
    const mode = normalizeMode(value, this.mode || DEFAULT_OPTIONS.mode);
    this.mode = mode;
    document.documentElement.dataset.neuInteraction = mode;
    this.root.dataset.neuInteraction = mode;
    if (options.persist !== false) {
      try { localStorage.setItem('sceneops.neumorphic.interaction-mode', mode); } catch { /* storage is optional */ }
    }
    this.refreshStackState();
    if (options.announce !== false) {
      window.dispatchEvent(new CustomEvent('sceneops:neumorphic-mode-changed', { detail: { mode } }));
    }
    this.log('mode', { mode });
    return mode;
  }

  rememberSource(element, explicit = {}) {
    const rect = explicit.rect ?? elementRect(element);
    if (!rect && !explicit.edge) return null;
    const source = {
      element: element instanceof Element ? element : null,
      rect,
      edge: explicit.edge ?? edgeFromPlacement(explicit.placement) ?? edgeFromElement(element),
      placement: explicit.placement ?? null,
      timestamp: now(),
    };
    this.lastSource = source;
    return source;
  }

  activateFrame(frame) {
    const rootFrame = this.findFrameRoot(frame);
    if (!(rootFrame instanceof HTMLElement)) return;
    const stackFrames = this.visibleStackFrames();
    for (const candidate of stackFrames) {
      const active = candidate === rootFrame;
      candidate.setAttribute(ACTIVE_ATTRIBUTE, String(active));
      const surface = resolveMotionSurface(candidate);
      if (surface instanceof HTMLElement) {
        surface.setAttribute(DEPTH_SURFACE_ATTRIBUTE, 'true');
        surface.setAttribute(ACTIVE_ATTRIBUTE, String(active));
      }
    }
    this.clearTilt(rootFrame);
  }

  async animateFrame(frame, source = this.currentSource()) {
    if (!(frame instanceof HTMLElement) || !frame.isConnected || this.reducedMotionQuery.matches) {
      frame?.removeAttribute?.(ENTERING_ATTRIBUTE);
      frame?.removeAttribute?.(REVEALING_ATTRIBUTE);
      return;
    }

    const target = await this.waitForFrameRect(frame);
    if (!target || !frame.isConnected) return;

    frame.setAttribute(ENTERING_ATTRIBUTE, this.mode);
    frame.dataset.neuOpenSource = formatSource(source);
    if (this.mode === NEUMORPHIC_INTERACTION_MODES.STACK) this.activateFrame(frame);

    try {
      if (this.mode === NEUMORPHIC_INTERACTION_MODES.SURFACE) {
        await this.animateSurfaceExtrusion(frame, target, source);
      } else if (this.mode === NEUMORPHIC_INTERACTION_MODES.STACK) {
        await this.animateDepthStack(frame, target, source);
      } else {
        await this.animateEdgeExtrusion(frame, target, source);
      }
    } finally {
      frame.removeAttribute(ENTERING_ATTRIBUTE);
      frame.removeAttribute(REVEALING_ATTRIBUTE);
      frame.style.removeProperty('visibility');
      frame.style.removeProperty('opacity');
      if (this.lastSource === source) this.lastSource = null;
    }
  }

  markExistingFrames() {
    for (const frame of this.root.querySelectorAll(this.options.frameSelector)) {
      this.registerFrame(frame, { animate: false });
    }
    this.refreshStackState();
  }

  registerFrame(frame, { animate = true } = {}) {
    if (!(frame instanceof HTMLElement) || frame.hasAttribute(FRAME_ATTRIBUTE)) return;
    frame.setAttribute(FRAME_ATTRIBUTE, 'true');
    const surface = resolveMotionSurface(frame);
    if (surface instanceof HTMLElement) {
      surface.setAttribute(DEPTH_SURFACE_ATTRIBUTE, 'true');
      surface.style.setProperty('--neu-tilt-x', '0deg');
      surface.style.setProperty('--neu-tilt-y', '0deg');
    }
    for (const nested of frame.querySelectorAll(this.options.frameSelector)) {
      if (nested !== frame && nested instanceof HTMLElement) nested.setAttribute(FRAME_ATTRIBUTE, 'true');
    }
    if (animate) this.scheduleFrame(frame);
  }

  scheduleFrame(frame) {
    if (this.pendingFrames.has(frame)) return;
    this.pendingFrames.add(frame);
    requestAnimationFrame(() => {
      if (!frame.isConnected || !isFrameVisible(frame)) return;
      void this.animateFrame(frame);
    });
  }

  currentSource() {
    if (!this.lastSource) return null;
    if (now() - this.lastSource.timestamp > this.options.sourceLifetimeMs) {
      this.lastSource = null;
      return null;
    }
    return this.lastSource;
  }

  findFrameRoot(input) {
    const element = input instanceof Element ? input : null;
    if (!element) return null;
    const frame = safeClosest(element, this.options.frameSelector);
    if (!frame) return null;
    const floating = safeClosest(frame, '.dv-floating-box');
    if (floating && this.root.contains(floating)) return floating;
    return frame;
  }

  visibleStackFrames() {
    const frames = [...this.root.querySelectorAll(STACK_FRAME_SELECTOR)]
      .filter(frame => frame instanceof HTMLElement && isFrameVisible(frame));
    return topLevelFrames(frames);
  }

  refreshStackState() {
    const frames = this.visibleStackFrames();
    if (!frames.length) return;
    const active = frames.find(frame => frame.getAttribute(ACTIVE_ATTRIBUTE) === 'true') ?? frames.at(-1);
    if (this.mode === NEUMORPHIC_INTERACTION_MODES.STACK) {
      this.activateFrame(active);
    } else {
      for (const frame of frames) {
        frame.removeAttribute(ACTIVE_ATTRIBUTE);
        const surface = resolveMotionSurface(frame);
        surface?.removeAttribute?.(ACTIVE_ATTRIBUTE);
        surface?.style?.setProperty?.('--neu-tilt-x', '0deg');
        surface?.style?.setProperty?.('--neu-tilt-y', '0deg');
      }
    }
  }

  async waitForFrameRect(frame) {
    for (let index = 0; index < 6; index += 1) {
      await nextPaint();
      if (!frame.isConnected) return null;
      const rect = elementRect(frame);
      if (rect && rect.width > 20 && rect.height > 20) return rect;
    }
    return elementRect(frame);
  }

  async animateSurfaceExtrusion(frame, target, source) {
    const styles = rootStyles();
    const fallbackSize = clamp(Math.min(target.width, target.height) * 0.12, 34, 84);
    const origin = source?.rect ?? {
      left: target.centerX - fallbackSize / 2,
      top: target.centerY - fallbackSize / 2,
      width: fallbackSize,
      height: fallbackSize,
      centerX: target.centerX,
      centerY: target.centerY,
    };

    const startScaleX = clamp(origin.width / target.width, 0.035, 0.56);
    const startScaleY = clamp(origin.height / target.height, 0.035, 0.56);
    const startX = origin.left - target.left;
    const startY = origin.top - target.top;
    const radius = Math.min(24, Math.max(12, parseFloat(getComputedStyle(frame).borderRadius) || 18));

    const flight = document.createElement('div');
    flight.className = 'neu-flight-shell';
    flight.setAttribute('aria-hidden', 'true');
    Object.assign(flight.style, {
      left: `${target.left}px`,
      top: `${target.top}px`,
      width: `${target.width}px`,
      height: `${target.height}px`,
      background: styles.base,
      color: styles.ink,
      borderRadius: `${radius}px`,
    });

    const highlight = document.createElement('span');
    highlight.className = 'neu-flight-shell__highlight';
    flight.append(highlight);
    document.body.append(flight);

    frame.setAttribute(REVEALING_ATTRIBUTE, 'true');
    frame.style.visibility = 'hidden';
    frame.style.opacity = '0';

    const animation = safeAnimate(flight, [
      {
        transform: `translate3d(${startX}px, ${startY}px, 0) scale(${startScaleX}, ${startScaleY})`,
        borderRadius: '999px',
        boxShadow: styles.insetXs,
        opacity: 0.18,
        offset: 0,
      },
      {
        transform: `translate3d(${startX * 0.18}px, ${startY * 0.18}px, 0) scale(${0.82 + startScaleX * 0.06}, ${0.78 + startScaleY * 0.08})`,
        borderRadius: `${Math.max(radius, 20)}px`,
        boxShadow: styles.hover,
        opacity: 0.96,
        offset: 0.68,
      },
      {
        transform: 'translate3d(0, 0, 0) scale(1, 1)',
        borderRadius: `${radius}px`,
        boxShadow: styles.raisedLg,
        opacity: 1,
        offset: 1,
      },
    ], {
      duration: this.options.surfaceDurationMs,
      easing: 'cubic-bezier(.22, 1, .36, 1)',
      fill: 'both',
    });

    await animationFinished(animation);
    if (!frame.isConnected) {
      flight.remove();
      return;
    }

    frame.style.visibility = 'visible';
    frame.style.opacity = '1';
    frame.removeAttribute(REVEALING_ATTRIBUTE);
    const surface = resolveMotionSurface(frame);
    const reveal = safeAnimate(surface, [
      { opacity: 0, filter: 'blur(2px)', transform: 'perspective(1600px) translateZ(-8px)' },
      { opacity: 1, filter: 'blur(0)', transform: 'perspective(1600px) translateZ(0)' },
    ], {
      duration: 220,
      easing: 'cubic-bezier(.22, 1, .36, 1)',
      fill: 'both',
    });
    await animationFinished(reveal);
    reveal?.cancel();
    flight.remove();
  }

  async animateEdgeExtrusion(frame, target, source) {
    const styles = rootStyles();
    const edge = inferEntryEdge(source, target);
    const surface = resolveMotionSurface(frame);
    const finalShadow = getComputedStyle(surface).boxShadow || styles.raised;
    const seam = this.createEdgeSeam(target, edge, styles);

    const animation = safeAnimate(surface, [
      {
        clipPath: clipForEdge(edge, 100),
        opacity: 0.22,
        boxShadow: styles.insetSm,
        offset: 0,
      },
      {
        clipPath: clipForEdge(edge, 24),
        opacity: 0.9,
        boxShadow: styles.hover,
        offset: 0.72,
      },
      {
        clipPath: clipForEdge(edge, 0),
        opacity: 1,
        boxShadow: finalShadow,
        offset: 1,
      },
    ], {
      duration: this.options.edgeDurationMs,
      easing: 'cubic-bezier(.2, .82, .24, 1)',
      fill: 'both',
    });

    const seamAnimation = safeAnimate(seam, [
      { opacity: 0, transform: 'scale(.18)' },
      { opacity: 0.92, transform: 'scale(1)', offset: 0.34 },
      { opacity: 0, transform: 'scale(.72)' },
    ], {
      duration: this.options.edgeDurationMs,
      easing: 'cubic-bezier(.22, 1, .36, 1)',
      fill: 'both',
    });

    await Promise.all([animationFinished(animation), animationFinished(seamAnimation)]);
    animation?.cancel();
    seam.remove();
  }

  createEdgeSeam(target, edge, styles) {
    const seam = document.createElement('div');
    seam.className = `neu-edge-seam neu-edge-seam--${edge}`;
    seam.setAttribute('aria-hidden', 'true');
    seam.style.setProperty('--neu-seam-accent', styles.accent);
    if (edge === 'left' || edge === 'right') {
      seam.style.top = `${target.top + 10}px`;
      seam.style.height = `${Math.max(24, target.height - 20)}px`;
      seam.style.left = `${edge === 'left' ? target.left : target.right - 4}px`;
      seam.style.width = '4px';
    } else {
      seam.style.left = `${target.left + 10}px`;
      seam.style.width = `${Math.max(24, target.width - 20)}px`;
      seam.style.top = `${edge === 'top' ? target.top : target.bottom - 4}px`;
      seam.style.height = '4px';
    }
    document.body.append(seam);
    return seam;
  }

  async animateDepthStack(frame, target, source) {
    const styles = rootStyles();
    const surface = resolveMotionSurface(frame);
    const dx = source?.rect ? clamp((source.rect.centerX - target.centerX) * 0.06, -18, 18) : 0;
    const dy = source?.rect ? clamp((source.rect.centerY - target.centerY) * 0.06, -14, 14) : 5;
    surface.setAttribute(ACTIVE_ATTRIBUTE, 'true');

    const animation = safeAnimate(surface, [
      {
        transform: `perspective(1600px) translate3d(${dx}px, ${dy}px, -42px) rotateX(0deg) rotateY(0deg)`,
        opacity: 0.2,
        boxShadow: styles.insetSm,
        filter: 'saturate(.92)',
        offset: 0,
      },
      {
        transform: 'perspective(1600px) translate3d(0, 0, 8px) rotateX(0deg) rotateY(0deg)',
        opacity: 1,
        boxShadow: styles.raisedSm,
        filter: 'saturate(1)',
        offset: 0.76,
      },
      {
        transform: 'perspective(1600px) translate3d(0, 0, 14px) rotateX(0deg) rotateY(0deg)',
        opacity: 1,
        boxShadow: styles.raisedLg,
        filter: 'saturate(1)',
        offset: 1,
      },
    ], {
      duration: this.options.stackDurationMs,
      easing: 'cubic-bezier(.16, 1, .3, 1)',
      fill: 'both',
    });

    await animationFinished(animation);
    animation?.cancel();
  }

  async animateFrameExit(frame, options = {}) {
    const rootFrame = this.findFrameRoot(frame) ?? frame;
    if (!(rootFrame instanceof HTMLElement) || !rootFrame.isConnected) {
      options.onComplete?.();
      return;
    }
    if (this.reducedMotionQuery.matches) {
      options.onComplete?.();
      return;
    }
    const target = elementRect(rootFrame);
    const surface = resolveMotionSurface(rootFrame);
    const styles = rootStyles();
    const edge = options.edge ?? inferEntryEdge({ placement: options.placement }, target ?? {
      left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight,
      width: window.innerWidth, height: window.innerHeight,
      centerX: window.innerWidth / 2, centerY: window.innerHeight / 2,
    });
    let keyframes;
    if (this.mode === NEUMORPHIC_INTERACTION_MODES.SURFACE) {
      keyframes = [
        { opacity: 1, filter: 'blur(0)', boxShadow: getComputedStyle(surface).boxShadow },
        { opacity: 0, filter: 'blur(1.8px)', transform: 'perspective(1600px) translateZ(-22px) scale(.78)', boxShadow: styles.insetSm },
      ];
    } else if (this.mode === NEUMORPHIC_INTERACTION_MODES.STACK) {
      keyframes = [
        { opacity: 1, filter: 'saturate(1)' },
        { opacity: 0, filter: 'saturate(.86)', transform: 'perspective(1600px) translateZ(-48px)', boxShadow: styles.insetSm },
      ];
    } else {
      keyframes = [
        { opacity: 1, clipPath: clipForEdge(edge, 0), boxShadow: getComputedStyle(surface).boxShadow },
        { opacity: 0.18, clipPath: clipForEdge(edge, 100), boxShadow: styles.insetSm },
      ];
    }
    const animation = safeAnimate(surface, keyframes, {
      duration: options.durationMs ?? 260,
      easing: 'cubic-bezier(.4, 0, .6, 1)',
      fill: 'both',
    });
    await animationFinished(animation);
    options.onComplete?.();
  }

  animateTab(tab) {
    const group = safeClosest(tab, '.dv-groupview, [data-neu-workframe]');
    const content = group?.querySelector?.('.dv-content-container, [data-neu-frame-content]') ?? group;
    if (!(content instanceof HTMLElement) || this.reducedMotionQuery.matches) return;

    let keyframes;
    if (this.mode === NEUMORPHIC_INTERACTION_MODES.SURFACE) {
      keyframes = [
        { opacity: 0.15, transform: 'perspective(1400px) translateZ(-16px)', filter: 'blur(1.5px)' },
        { opacity: 1, transform: 'perspective(1400px) translateZ(0)', filter: 'blur(0)' },
      ];
    } else if (this.mode === NEUMORPHIC_INTERACTION_MODES.STACK) {
      keyframes = [
        { opacity: 0.28, transform: 'perspective(1400px) translateZ(-20px)' },
        { opacity: 1, transform: 'perspective(1400px) translateZ(6px)' },
      ];
      this.activateFrame(group);
    } else {
      keyframes = [
        { opacity: 0.28, clipPath: 'inset(0 0 100% 0 round 12px)' },
        { opacity: 1, clipPath: 'inset(0 0 0 0 round 12px)' },
      ];
    }

    const animation = safeAnimate(content, keyframes, {
      duration: this.options.tabDurationMs,
      easing: 'cubic-bezier(.22, 1, .36, 1)',
    });
    void animationFinished(animation).then(() => animation?.cancel());
  }

  createPressurePulse(source) {
    if (!source?.rect || this.reducedMotionQuery.matches) return;
    const size = clamp(Math.max(source.rect.width, source.rect.height) + 18, 42, 116);
    const pulse = document.createElement('span');
    pulse.className = 'neu-pressure-field';
    pulse.setAttribute('aria-hidden', 'true');
    Object.assign(pulse.style, {
      width: `${size}px`,
      height: `${size}px`,
      left: `${source.rect.centerX - size / 2}px`,
      top: `${source.rect.centerY - size / 2}px`,
    });
    document.body.append(pulse);
    const animation = safeAnimate(pulse, [
      { opacity: 0.52, transform: 'scale(.68)', boxShadow: rootStyles().insetXs },
      { opacity: 0, transform: 'scale(1.36)', boxShadow: rootStyles().raisedSm },
    ], {
      duration: 360,
      easing: 'cubic-bezier(.22, 1, .36, 1)',
    });
    void animationFinished(animation).then(() => pulse.remove());
  }

  onPointerDown(event) {
    const sourceElement = safeClosest(event.target, this.options.sourceSelector);
    if (sourceElement && this.root.contains(sourceElement)) {
      const source = this.rememberSource(sourceElement);
      sourceElement.setAttribute(PRESSING_ATTRIBUTE, 'true');
      sourceElement.style.setProperty('--neu-pointer-pressure', String(event.pressure || 0.5));
      this.pressSource = sourceElement;
      if (this.mode === NEUMORPHIC_INTERACTION_MODES.SURFACE) this.createPressurePulse(source);
    }

    const frame = this.findFrameRoot(event.target);
    if (frame) this.activateFrame(frame);
  }

  onPointerRelease() {
    this.releasePressure();
  }

  releasePressure() {
    if (this.pressSource instanceof HTMLElement) {
      this.pressSource.removeAttribute(PRESSING_ATTRIBUTE);
      this.pressSource.style.removeProperty('--neu-pointer-pressure');
    }
    this.pressSource = null;
  }

  onClick(event) {
    const sourceElement = safeClosest(event.target, this.options.sourceSelector);
    if (sourceElement && this.root.contains(sourceElement)) {
      this.rememberSource(sourceElement);
    }
    const tab = safeClosest(event.target, TAB_SELECTOR);
    if (tab && this.root.contains(tab)) requestAnimationFrame(() => this.animateTab(tab));
  }

  onToggle(event) {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement) || !details.open) return;
    const frame = details.querySelector('.forge-area-menu, .forge-window-options, [role="menu"], [role="dialog"]');
    if (frame instanceof HTMLElement) {
      frame.removeAttribute(FRAME_ATTRIBUTE);
      this.registerFrame(frame, { animate: true });
    }
  }

  onPointerOver(event) {
    const edge = safeClosest(event.target, EDGE_SELECTOR);
    if (edge && this.root.contains(edge)) edge.setAttribute('data-neu-edge-near', 'true');
  }

  onPointerOut(event) {
    const edge = safeClosest(event.target, EDGE_SELECTOR);
    if (edge && !edge.contains(event.relatedTarget)) edge.removeAttribute('data-neu-edge-near');
    const surface = safeClosest(event.target, `[${DEPTH_SURFACE_ATTRIBUTE}]`);
    if (surface && !surface.contains(event.relatedTarget)) this.clearTilt(surface);
  }

  onPointerMove(event) {
    if (this.mode !== NEUMORPHIC_INTERACTION_MODES.STACK || this.reducedMotionQuery.matches || !this.finePointerQuery.matches) return;
    const surface = safeClosest(event.target, `[${DEPTH_SURFACE_ATTRIBUTE}][${ACTIVE_ATTRIBUTE}="true"]`);
    if (!(surface instanceof HTMLElement)) return;
    this.tiltSurface = surface;
    this.tiltPoint = { x: event.clientX, y: event.clientY };
    if (this.tiltFrame) return;
    this.tiltFrame = requestAnimationFrame(() => {
      this.tiltFrame = 0;
      this.applyTilt();
    });
  }

  applyTilt() {
    const surface = this.tiltSurface;
    const point = this.tiltPoint;
    if (!(surface instanceof HTMLElement) || !point || !surface.isConnected) return;
    const rect = surface.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const nx = clamp((point.x - rect.left) / rect.width * 2 - 1, -1, 1);
    const ny = clamp((point.y - rect.top) / rect.height * 2 - 1, -1, 1);
    surface.style.setProperty('--neu-tilt-x', `${(-ny * this.options.tiltDegreesX).toFixed(3)}deg`);
    surface.style.setProperty('--neu-tilt-y', `${(nx * this.options.tiltDegreesY).toFixed(3)}deg`);
  }

  clearTilt(exceptFrame = null) {
    const surfaces = this.root.querySelectorAll(`[${DEPTH_SURFACE_ATTRIBUTE}]`);
    for (const surface of surfaces) {
      if (exceptFrame && exceptFrame.contains(surface)) continue;
      surface.style.setProperty('--neu-tilt-x', '0deg');
      surface.style.setProperty('--neu-tilt-y', '0deg');
    }
    if (!exceptFrame || !exceptFrame.contains(this.tiltSurface)) {
      this.tiltSurface = null;
      this.tiltPoint = null;
    }
  }

  onExternalSource(event) {
    const detail = event.detail ?? {};
    const element = detail.element instanceof Element ? detail.element : null;
    this.rememberSource(element, {
      rect: detail.rect ?? elementRect(element),
      edge: detail.edge ?? edgeFromPlacement(detail.placement) ?? edgeFromElement(element),
      placement: detail.placement ?? null,
    });
  }

  onExternalActivation(event) {
    const frame = event.detail?.frame;
    if (frame instanceof HTMLElement) this.activateFrame(frame);
  }

  onExternalClose(event) {
    const detail = event.detail ?? {};
    if (!(detail.frame instanceof HTMLElement)) return;
    void this.animateFrameExit(detail.frame, detail);
  }

  onMutations(records) {
    const frames = [];
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of record.addedNodes) frames.push(...collectFrames(node, this.options.frameSelector));
      } else if (record.type === 'attributes' && record.target instanceof HTMLElement) {
        const target = record.target;
        if (target.matches(this.options.frameSelector) && isFrameVisible(target)) {
          if (!target.hasAttribute(FRAME_ATTRIBUTE)) frames.push(target);
        } else if (target instanceof HTMLDialogElement && target.open) {
          target.removeAttribute(FRAME_ATTRIBUTE);
          frames.push(target);
        }
      }
    }
    for (const frame of topLevelFrames(frames)) this.registerFrame(frame, { animate: true });
  }

  log(message, detail) {
    if (!this.options.debug) return;
    console.debug(`[neumorphic-interactions] ${message}`, detail ?? '');
  }
}

export function installNeumorphicInteractions(root, options = {}) {
  return new NeumorphicInteractionController(root, options).mount();
}

export function requestNeumorphicFrameClose(frame, options = {}) {
  return new Promise(resolve => {
    let settled = false;
    const complete = () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallbackTimer);
      resolve();
    };
    const fallbackTimer = window.setTimeout(complete, options.fallbackMs ?? 360);
    window.dispatchEvent(new CustomEvent('sceneops:neumorphic-close-frame', {
      detail: { ...options, frame, onComplete: complete },
    }));
  });
}

export function readNeumorphicInteractionMode(fallback = String(DEFAULT_OPTIONS.mode)) {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('neuMotion') || params.get('interaction');
  if (fromUrl) return normalizeMode(fromUrl, fallback);
  try {
    return normalizeMode(localStorage.getItem('sceneops.neumorphic.interaction-mode'), fallback);
  } catch {
    return normalizeMode(fallback);
  }
}

export function describeNeumorphicInteractionMode(mode) {
  const normalized = normalizeMode(mode);
  if (normalized === NEUMORPHIC_INTERACTION_MODES.SURFACE) {
    return {
      id: normalized,
      title: '方案一 · 屏幕塑形',
      shortTitle: '屏幕塑形',
      description: '工作框从触发点压入屏幕，再像柔性表面充气一样向外成形。',
    };
  }
  if (normalized === NEUMORPHIC_INTERACTION_MODES.STACK) {
    return {
      id: normalized,
      title: '方案三 · 景深叠层',
      shortTitle: '景深叠层',
      description: '工作框作为不同 Z 层存在；激活框上升，其他框回落到屏幕表面。',
    };
  }
  return {
    id: normalized,
    title: '方案二 · 边缘抽出',
    shortTitle: '边缘抽出',
    description: '工作框沿拉出方向从屏幕接缝展开，适合 Dock、分屏和高频工作台。',
  };
}
