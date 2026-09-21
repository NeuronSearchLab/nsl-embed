/**
 * The debug overlay.
 *
 * A blank or generic strip has several indistinguishable causes: the key was
 * rejected for this origin, the page's item is not in the catalogue, the
 * response carried no request_id so nothing is instrumented, or there simply
 * are no recommendations yet. From the outside they all look the same, and each
 * one currently arrives as a support ticket.
 *
 * So the widget says which. Everything here is already known at the moment it
 * goes wrong - this only makes it visible, on the page, to whoever is looking.
 */

interface MountRow {
  surface: string;
  ref: string;
  status: string;
  detail: string;
}

let panel: HTMLElement | null = null;
let body: HTMLElement | null = null;
const rows: MountRow[] = [];
let events = 0;

/**
 * Debug is on with data-nsl-debug on the tag, or ?nsl_debug=1 on the URL.
 *
 * The query parameter is the one that matters in practice: the tag is usually
 * baked into a theme or a tag manager, and asking someone to deploy a change to
 * diagnose a live page is how a five-minute problem becomes a five-day one.
 */
export function debugRequested(tagFlag: boolean): boolean {
  if (tagFlag) return true;
  try {
    return new URLSearchParams(window.location.search).get('nsl_debug') === '1';
  } catch {
    return false;
  }
}

const STYLES = `
:host { all: initial; }
.p {
  position: fixed; bottom: 12px; right: 12px; z-index: 2147483647;
  max-width: 380px; max-height: 50vh; overflow: auto;
  font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  background: #11151c; color: #e6edf3; border: 1px solid #30363d;
  border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.4);
}
.h {
  display: flex; justify-content: space-between; gap: 12px; align-items: center;
  padding: 8px 10px; border-bottom: 1px solid #30363d; font-weight: 600;
}
.x { cursor: pointer; color: #8b949e; border: 0; background: none; font: inherit; }
.r { padding: 8px 10px; border-bottom: 1px solid #21262d; }
.r:last-child { border-bottom: 0; }
.s { font-weight: 600; }
.ok { color: #3fb950; }
.warn { color: #d29922; }
.err { color: #f85149; }
.d { color: #8b949e; word-break: break-all; }
`;

function ensurePanel(): void {
  if (panel || typeof document === 'undefined') return;

  panel = document.createElement('div');
  // Shadow DOM for the same reason the strip uses it: this renders on someone
  // else's page and must neither inherit their styles nor leak into them.
  const root = panel.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  root.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'p';

  const header = document.createElement('div');
  header.className = 'h';
  const title = document.createElement('span');
  title.textContent = 'nsl-embed';
  const close = document.createElement('button');
  close.className = 'x';
  close.textContent = 'close';
  close.addEventListener('click', () => panel?.remove());
  header.appendChild(title);
  header.appendChild(close);
  wrap.appendChild(header);

  body = document.createElement('div');
  wrap.appendChild(body);
  root.appendChild(wrap);

  document.body.appendChild(panel);
}

function paint(): void {
  if (!body) return;
  body.textContent = '';

  for (const row of rows) {
    const line = document.createElement('div');
    line.className = 'r';

    const status = document.createElement('div');
    status.className = `s ${row.status === 'ok' ? 'ok' : row.status === 'warn' ? 'warn' : 'err'}`;
    status.textContent = `${row.surface} · ${row.ref}`;
    line.appendChild(status);

    const detail = document.createElement('div');
    detail.className = 'd';
    // textContent throughout: these strings include catalogue values and a
    // customer's own URLs, and the overlay is not a reason to introduce the
    // one injection sink the rest of the widget carefully avoids.
    detail.textContent = row.detail;
    line.appendChild(detail);

    body.appendChild(line);
  }

  const footer = document.createElement('div');
  footer.className = 'r d';
  footer.textContent = `${events} event${events === 1 ? '' : 's'} sent`;
  body.appendChild(footer);
}

/** Record what happened to one placeholder. */
export function reportMount(row: MountRow): void {
  ensurePanel();
  rows.push(row);
  paint();
}

export function reportEvent(): void {
  events += 1;
  paint();
}

/** Test seam. */
export function resetDebug(): void {
  panel?.remove();
  panel = null;
  body = null;
  rows.length = 0;
  events = 0;
}
