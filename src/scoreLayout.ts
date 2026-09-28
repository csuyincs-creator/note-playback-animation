import type {ScoreDirection, ScoreProject} from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';
const KEEP_UPRIGHT = 'g.note, g.rest, g.clef, g.keySig, g.meterSig, g.dynam, g.dir, g.tempo, g.text, g.ending, g.rehearsal, g.artic, g.ornam, g.fermata, g.accid, g.lyric';

function boundsCenterInRoot(element: SVGGraphicsElement, rootInverse: DOMMatrix) {
  const box = element.getBBox();
  const matrix = rootInverse.multiply(element.getScreenCTM()!);
  const corners = [
    new DOMPoint(box.x, box.y), new DOMPoint(box.x + box.width, box.y),
    new DOMPoint(box.x, box.y + box.height), new DOMPoint(box.x + box.width, box.y + box.height),
  ].map(point => point.matrixTransform(matrix));
  return (Math.min(...corners.map(point => point.x)) + Math.max(...corners.map(point => point.x))) / 2;
}

function parentSpaceX(element: SVGGraphicsElement, parent: SVGGraphicsElement, box: DOMRect) {
  const relative = parent.getScreenCTM()!.inverse().multiply(element.getScreenCTM()!);
  return new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(relative).x;
}

function keepGlyphsUpright(system: SVGGElement) {
  const nodes = [...system.querySelectorAll<SVGGElement>(KEEP_UPRIGHT)];
  const candidates = nodes.filter(node => !node.parentElement?.closest(KEEP_UPRIGHT));
  for (const node of candidates) {
    const parent = node.parentElement;
    if (!(parent instanceof SVGGraphicsElement)) continue;
    const centerX = parentSpaceX(node, parent, node.getBBox());
    const wrapper = document.createElementNS(SVG_NS, 'g');
    wrapper.setAttribute('transform', `translate(${2 * centerX} 0) scale(-1 1)`);
    parent.insertBefore(wrapper, node);
    wrapper.appendChild(node);
  }
}

/** Derives a display-only project from its canonical left-to-right score. */
export function applyScoreDirection(project: ScoreProject, direction: ScoreDirection): ScoreProject {
  if (direction !== 'serpentine') return project;
  const xml = new DOMParser().parseFromString(project.svg, 'image/svg+xml');
  const root = xml.documentElement as unknown as SVGSVGElement;
  if (xml.querySelector('parsererror') || root.tagName.toLowerCase() !== 'svg') return project;

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-30000px;top:0;width:1600px;pointer-events:none;visibility:hidden';
  host.append(root);
  document.body.append(host);
  try {
    const rootInverse = root.getScreenCTM()?.inverse();
    if (!rootInverse) return project;
    const systems = [...root.querySelectorAll<SVGGElement>('g.system')];
    const centers = systems.map(system => boundsCenterInRoot(system, rootInverse));

    systems.forEach((system, index) => {
      if (index % 2 === 0) return;
      keepGlyphsUpright(system);
      const box = system.getBBox();
      const centerX = box.x + box.width / 2;
      const original = system.getAttribute('transform');
      const mirror = `translate(${2 * centerX} 0) scale(-1 1)`;
      system.setAttribute('transform', original ? `${original} ${mirror}` : mirror);
    });

    const events = project.events.map(event => {
      const center = centers[event.system];
      return center === undefined || event.system % 2 === 0 ? event : {...event, x: 2 * center - event.x};
    });
    return {...project, svg: new XMLSerializer().serializeToString(root), events};
  } catch {
    return project;
  } finally {
    host.remove();
  }
}
