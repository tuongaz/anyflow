/**
 * US-011 / US-012 / US-023: drop-payload helpers for the canvas wrapper.
 *
 * The wrapper-level useEffect in demo-canvas.tsx attaches `dragover` + `drop`
 * listeners to the canvas root so external image files (Finder / Explorer) and
 * web-image URL drags (text/uri-list) can ingest into the canvas. The
 * orchestration here is split out so it is testable WITHOUT a DOM — the
 * production code passes through a thin DragEvent-shaped object and lets
 * `handleCanvasDrop` resolve which branch wins.
 *
 * The split exists because US-023 needed a regression test that bun's test
 * runner (no DOM) could execute. Inlining the logic in a useEffect made it
 * untestable without a heavy DOM shim. Keeping it pure lets a future
 * marquee/perf refactor in demo-canvas.tsx not silently regress the drop path.
 */

/**
 * Returns the first http(s) URL from a multi-line text payload (the format
 * used by `text/uri-list` per RFC 2483 — # prefix is a comment, blank lines
 * are ignored). Returns null if no http(s) URL is found.
 */
export function pickHttpUrl(text: string): string | null {
  if (!text) return null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^https?:\/\//i.test(line)) return line;
  }
  return null;
}

/**
 * Filters a FileList-like to only image/* files. Returns an empty array when
 * the list is null/empty or no files match.
 */
export function imageFilesFrom(files: FileList | null | undefined): File[] {
  if (!files) return [];
  const out: File[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file?.type.startsWith('image/')) out.push(file);
  }
  return out;
}

/**
 * True if the drag's `types` array contains the target type. xyflow / React's
 * synthetic DragEvent surfaces this as a real array OR a DOMStringList — we
 * iterate by index to handle both.
 */
export function dragHasType(types: ArrayLike<string> | null | undefined, target: string): boolean {
  if (!types) return false;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === target) return true;
  }
  return false;
}

/**
 * True if the drag payload is something we know how to handle (image file when
 * `hasFileGate` is on, or http(s) URL when `hasUrlGate` is on). The gates
 * mirror the optional callbacks in DemoCanvasProps — when a callback is
 * absent, we don't intercept that drag-kind so it falls through to the
 * browser's default behaviour.
 */
export function isCandidateImageDrag(
  types: ArrayLike<string> | null | undefined,
  gates: { file: boolean; url: boolean },
): boolean {
  if (gates.file && dragHasType(types, 'Files')) return true;
  if (gates.url && (dragHasType(types, 'text/uri-list') || dragHasType(types, 'text/plain'))) {
    return true;
  }
  return false;
}

export type CanvasDropEvent = {
  dataTransfer: {
    files: FileList | null;
    getData: (key: string) => string;
  } | null;
  clientX: number;
  clientY: number;
  preventDefault: () => void;
};

export type CanvasDropDeps = {
  /** Parent's image-file ingester. When absent, file drops are not consumed. */
  onCreateImageNode?: (image: string, position: { x: number; y: number }) => void;
  /** Parent's URL ingester. When absent, URL drops are not consumed. */
  onIngestImageUrl?: (url: string, position: { x: number; y: number }) => void;
  /** Maps client (screen) px → flow space — usually rfInstance.screenToFlowPosition. */
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number };
  /** The committed imageNode's default render size (used for the centering offset). */
  imageDefaultSize: { width: number; height: number };
  /**
   * Reads a File to a base64 data: URL. Production passes a wrapper around
   * FileReader.readAsDataURL; tests pass a deterministic stub.
   */
  readFileAsDataUrl: (file: File) => Promise<string>;
};

export type CanvasDropOutcome = 'file' | 'url' | 'none';

/**
 * Handles a drop event on the canvas wrapper. File branch wins over URL
 * branch — matches the order in demo-canvas.tsx's original inline handler so a
 * drag carrying both files and a text fallback (some browsers do this)
 * commits the local file as the source of truth.
 *
 * Returns:
 * - 'file' — at least one image file was handled (callback fires per file)
 * - 'url' — a single http(s) URL was handled
 * - 'none' — nothing actionable, no preventDefault, no callback
 */
export async function handleCanvasDrop(
  e: CanvasDropEvent,
  deps: CanvasDropDeps,
): Promise<CanvasDropOutcome> {
  const dt = e.dataTransfer;
  if (!dt) return 'none';

  if (deps.onCreateImageNode) {
    const imageFiles = imageFilesFrom(dt.files);
    if (imageFiles.length > 0) {
      e.preventDefault();
      const baseFlow = deps.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const onCreate = deps.onCreateImageNode;
      // Per-file try/catch matches the original inline handler's
      // silent-no-op behaviour for FileReader errors — a single bad file in a
      // multi-drop shouldn't cancel the other commits.
      await Promise.all(
        imageFiles.map(async (file, index) => {
          try {
            const dataUrl = await deps.readFileAsDataUrl(file);
            const offset = index * 24;
            onCreate(dataUrl, {
              x: baseFlow.x - deps.imageDefaultSize.width / 2 + offset,
              y: baseFlow.y - deps.imageDefaultSize.height / 2 + offset,
            });
          } catch {
            // swallow — matches pre-refactor behaviour where FileReader
            // errors were not surfaced to the user.
          }
        }),
      );
      return 'file';
    }
  }

  if (deps.onIngestImageUrl) {
    const url = pickHttpUrl(dt.getData('text/uri-list')) ?? pickHttpUrl(dt.getData('text/plain'));
    if (url) {
      e.preventDefault();
      const baseFlow = deps.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      deps.onIngestImageUrl(url, {
        x: baseFlow.x - deps.imageDefaultSize.width / 2,
        y: baseFlow.y - deps.imageDefaultSize.height / 2,
      });
      return 'url';
    }
  }

  return 'none';
}
