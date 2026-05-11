import { describe, expect, it } from 'bun:test';
import {
  type CanvasDropDeps,
  type CanvasDropEvent,
  dragHasType,
  handleCanvasDrop,
  imageFilesFrom,
  isCandidateImageDrag,
  pickHttpUrl,
} from '@/lib/canvas-drop';

// Bun's runtime ships `File` globally — pre-1.0 used to need a polyfill, but
// the version pinned in this repo's package.json (>=1.3) exposes it.
type FileLike = File;

const makeFile = (name: string, type: string, contents = 'x'): FileLike =>
  new File([contents], name, { type });

/**
 * Minimal FileList-shaped object — DataTransfer.files is a FileList in the
 * browser, but bun's test runtime doesn't ship a constructor for it. The
 * handler only reads `.length` and `[index]`, so a plain index-keyed object
 * with a length suffices.
 */
const fileListOf = (files: FileLike[]): FileList => {
  const list: Record<string | number, unknown> = { length: files.length };
  files.forEach((f, i) => {
    list[i] = f;
  });
  return list as unknown as FileList;
};

type MakeEventPayload = {
  files?: FileLike[];
  text?: Record<string, string>;
};

const makeEvent = (
  partial: MakeEventPayload,
  clientX = 100,
  clientY = 80,
): CanvasDropEvent & { preventDefaultCount: number } => {
  let preventDefaultCount = 0;
  const event: CanvasDropEvent & { preventDefaultCount: number } = {
    dataTransfer: {
      files: partial.files ? fileListOf(partial.files) : null,
      getData: (key: string) => partial.text?.[key] ?? '',
    },
    clientX,
    clientY,
    preventDefault: () => {
      preventDefaultCount++;
    },
    get preventDefaultCount() {
      return preventDefaultCount;
    },
  };
  return event;
};

const defaultDeps = (overrides: Partial<CanvasDropDeps> = {}): CanvasDropDeps => ({
  // Identity mapping keeps the centering math obvious in assertions.
  screenToFlowPosition: ({ x, y }) => ({ x, y }),
  imageDefaultSize: { width: 200, height: 160 },
  readFileAsDataUrl: async (file) => `data:${file.type};base64,FAKE-${file.name}`,
  ...overrides,
});

describe('pickHttpUrl', () => {
  it('returns the first http(s) URL from a single-line payload', () => {
    expect(pickHttpUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(pickHttpUrl('http://example.com/b.jpg')).toBe('http://example.com/b.jpg');
  });

  it('skips comments and blank lines per RFC 2483', () => {
    const text = '# comment\n\nhttps://example.com/c.png\nhttps://example.com/d.png';
    expect(pickHttpUrl(text)).toBe('https://example.com/c.png');
  });

  it('rejects non-http schemes and returns null when nothing matches', () => {
    expect(pickHttpUrl('')).toBeNull();
    expect(pickHttpUrl('file:///tmp/local.png')).toBeNull();
    expect(pickHttpUrl('javascript:alert(1)')).toBeNull();
    expect(pickHttpUrl('not a url')).toBeNull();
  });

  it('trims whitespace around the URL', () => {
    expect(pickHttpUrl('   https://example.com/x.png   ')).toBe('https://example.com/x.png');
  });
});

describe('imageFilesFrom', () => {
  it('returns only files whose type starts with image/', () => {
    const list = fileListOf([
      makeFile('a.png', 'image/png'),
      makeFile('b.txt', 'text/plain'),
      makeFile('c.jpg', 'image/jpeg'),
    ]);
    const filtered = imageFilesFrom(list);
    expect(filtered.map((f) => f.name)).toEqual(['a.png', 'c.jpg']);
  });

  it('returns empty array for null / empty input', () => {
    expect(imageFilesFrom(null)).toEqual([]);
    expect(imageFilesFrom(undefined)).toEqual([]);
    expect(imageFilesFrom(fileListOf([]))).toEqual([]);
  });
});

describe('dragHasType / isCandidateImageDrag', () => {
  it('detects exact-match types on either an array or a DOMStringList-shape', () => {
    expect(dragHasType(['Files', 'text/plain'], 'Files')).toBe(true);
    expect(dragHasType({ length: 1, 0: 'Files' } as unknown as ArrayLike<string>, 'Files')).toBe(
      true,
    );
    expect(dragHasType(['text/plain'], 'Files')).toBe(false);
    expect(dragHasType(null, 'Files')).toBe(false);
  });

  it('only considers File payloads when the file gate is open', () => {
    expect(isCandidateImageDrag(['Files'], { file: true, url: false })).toBe(true);
    expect(isCandidateImageDrag(['Files'], { file: false, url: true })).toBe(false);
  });

  it('only considers URL payloads when the url gate is open', () => {
    expect(isCandidateImageDrag(['text/uri-list'], { file: false, url: true })).toBe(true);
    expect(isCandidateImageDrag(['text/plain'], { file: false, url: true })).toBe(true);
    expect(isCandidateImageDrag(['text/uri-list'], { file: true, url: false })).toBe(false);
  });

  it('returns false when the payload has no actionable type', () => {
    expect(isCandidateImageDrag(['application/json'], { file: true, url: true })).toBe(false);
    expect(isCandidateImageDrag(null, { file: true, url: true })).toBe(false);
  });
});

describe('handleCanvasDrop — US-023 regression coverage', () => {
  it('image-file drop calls onCreateImageNode with a data: URL and centered position', async () => {
    const calls: Array<{ url: string; position: { x: number; y: number } }> = [];
    const deps = defaultDeps({
      onCreateImageNode: (url, position) => calls.push({ url, position }),
    });
    const event = makeEvent({ files: [makeFile('hello.png', 'image/png')] }, 500, 400);

    const outcome = await handleCanvasDrop(event, deps);

    expect(outcome).toBe('file');
    expect(event.preventDefaultCount).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('data:image/png;base64,FAKE-hello.png');
    // 500 − 200/2 = 400, 400 − 160/2 = 320 — centered on the cursor.
    expect(calls[0]?.position).toEqual({ x: 400, y: 320 });
  });

  it('multi-file drop fires one callback per file at +24px diagonal offsets', async () => {
    const calls: Array<{ url: string; position: { x: number; y: number } }> = [];
    const deps = defaultDeps({
      onCreateImageNode: (url, position) => calls.push({ url, position }),
    });
    const event = makeEvent(
      {
        files: [
          makeFile('one.png', 'image/png'),
          makeFile('two.png', 'image/png'),
          makeFile('three.png', 'image/png'),
        ],
      },
      300,
      200,
    );

    await handleCanvasDrop(event, deps);

    expect(calls).toHaveLength(3);
    // Each subsequent commit shifts (24, 24) from the previous so a multi-drop
    // doesn't pile every image onto the same point.
    expect(calls[0]?.position).toEqual({ x: 200, y: 120 });
    expect(calls[1]?.position).toEqual({ x: 224, y: 144 });
    expect(calls[2]?.position).toEqual({ x: 248, y: 168 });
  });

  it('mixed file + non-image drop only ingests the image/* entries', async () => {
    const calls: string[] = [];
    const deps = defaultDeps({
      onCreateImageNode: (url) => calls.push(url),
    });
    const event = makeEvent({
      files: [
        makeFile('readme.txt', 'text/plain'),
        makeFile('photo.jpg', 'image/jpeg'),
        makeFile('archive.zip', 'application/zip'),
      ],
    });

    await handleCanvasDrop(event, deps);

    expect(calls).toEqual(['data:image/jpeg;base64,FAKE-photo.jpg']);
  });

  it('non-image-only drop is a silent no-op (no preventDefault, no callback)', async () => {
    let fileCalls = 0;
    let urlCalls = 0;
    const deps = defaultDeps({
      onCreateImageNode: () => fileCalls++,
      onIngestImageUrl: () => urlCalls++,
    });
    const event = makeEvent({ files: [makeFile('note.txt', 'text/plain')] });

    const outcome = await handleCanvasDrop(event, deps);

    expect(outcome).toBe('none');
    expect(event.preventDefaultCount).toBe(0);
    expect(fileCalls).toBe(0);
    expect(urlCalls).toBe(0);
  });

  it('URL drop via text/uri-list calls onIngestImageUrl with the parsed URL', async () => {
    const calls: Array<{ url: string; position: { x: number; y: number } }> = [];
    const deps = defaultDeps({
      onIngestImageUrl: (url, position) => calls.push({ url, position }),
    });
    const event = makeEvent(
      {
        text: { 'text/uri-list': 'https://example.com/from-web.png' },
      },
      200,
      150,
    );

    const outcome = await handleCanvasDrop(event, deps);

    expect(outcome).toBe('url');
    expect(event.preventDefaultCount).toBe(1);
    expect(calls).toEqual([
      { url: 'https://example.com/from-web.png', position: { x: 100, y: 70 } },
    ]);
  });

  it('URL drop falls back to text/plain when text/uri-list is empty', async () => {
    const calls: string[] = [];
    const deps = defaultDeps({
      onIngestImageUrl: (url) => calls.push(url),
    });
    const event = makeEvent({
      text: { 'text/uri-list': '', 'text/plain': 'https://example.com/fallback.png' },
    });

    await handleCanvasDrop(event, deps);

    expect(calls).toEqual(['https://example.com/fallback.png']);
  });

  it('file branch wins when both files and a text payload are present', async () => {
    const fileCalls: string[] = [];
    const urlCalls: string[] = [];
    const deps = defaultDeps({
      onCreateImageNode: (url) => fileCalls.push(url),
      onIngestImageUrl: (url) => urlCalls.push(url),
    });
    const event = makeEvent({
      files: [makeFile('local.png', 'image/png')],
      text: { 'text/uri-list': 'https://example.com/web.png' },
    });

    const outcome = await handleCanvasDrop(event, deps);

    expect(outcome).toBe('file');
    expect(fileCalls).toEqual(['data:image/png;base64,FAKE-local.png']);
    expect(urlCalls).toEqual([]);
  });

  it('does not consume file drops when onCreateImageNode is omitted', async () => {
    const urlCalls: string[] = [];
    const deps = defaultDeps({
      onIngestImageUrl: (url) => urlCalls.push(url),
    });
    const event = makeEvent({
      files: [makeFile('local.png', 'image/png')],
      text: { 'text/uri-list': 'https://example.com/web.png' },
    });

    const outcome = await handleCanvasDrop(event, deps);

    // File gate is closed → file branch is skipped; URL branch handles it.
    expect(outcome).toBe('url');
    expect(urlCalls).toEqual(['https://example.com/web.png']);
  });

  it('does not consume URL drops when onIngestImageUrl is omitted', async () => {
    const deps = defaultDeps({
      onCreateImageNode: () => {},
    });
    const event = makeEvent({
      text: { 'text/uri-list': 'https://example.com/web.png' },
    });

    const outcome = await handleCanvasDrop(event, deps);

    expect(outcome).toBe('none');
    expect(event.preventDefaultCount).toBe(0);
  });

  it('null dataTransfer returns none without crashing', async () => {
    const deps = defaultDeps({ onCreateImageNode: () => {}, onIngestImageUrl: () => {} });
    const event: CanvasDropEvent & { preventDefaultCount: number } = {
      dataTransfer: null,
      clientX: 0,
      clientY: 0,
      preventDefault: () => {},
      preventDefaultCount: 0,
    };

    const outcome = await handleCanvasDrop(event, deps);

    expect(outcome).toBe('none');
  });

  it('FileReader errors on one file do not block the rest of a multi-drop', async () => {
    const calls: string[] = [];
    const deps = defaultDeps({
      onCreateImageNode: (url) => calls.push(url),
      readFileAsDataUrl: async (file) => {
        if (file.name === 'bad.png') throw new Error('reader exploded');
        return `data:${file.type};base64,FAKE-${file.name}`;
      },
    });
    const event = makeEvent({
      files: [
        makeFile('good-a.png', 'image/png'),
        makeFile('bad.png', 'image/png'),
        makeFile('good-c.png', 'image/png'),
      ],
    });

    const outcome = await handleCanvasDrop(event, deps);

    expect(outcome).toBe('file');
    expect(calls).toEqual([
      'data:image/png;base64,FAKE-good-a.png',
      'data:image/png;base64,FAKE-good-c.png',
    ]);
  });
});
