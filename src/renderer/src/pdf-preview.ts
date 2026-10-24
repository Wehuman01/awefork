/**
 * PDF preview: rasterize the first pages in the renderer.
 *
 * pdfjs needs a canvas to draw on, which only the renderer has, so the
 * document's bytes cross IPC once (as a data URL) and every page image is
 * produced here. The library is imported lazily: a person who never opens
 * a PDF never pays for the ~1 MB of parser.
 *
 * Bounds, all enforced here rather than trusted to the document: at most
 * MAX_PAGES pages are rendered, each at a width that keeps the raster
 * small, and a single failure anywhere degrades to the error pane instead
 * of hanging the preview.
 */

/** Pages rendered per preview; the rest of the document stays in the app
 *  that owns it (the preview offers the system open). */
const MAX_PAGES = 3;
/** Raster width in device pixels; the pane scales it down to fit. */
const PAGE_WIDTH = 1240;
/** JPEG keeps a page of vector art far smaller than a PNG of the same. */
const PAGE_QUALITY = 0.85;

export interface PdfPageResult {
  pages: string[];
  pageCount: number;
}

/** The subset of pdfjs this module touches, so the import stays typed. */
interface PdfRenderTask {
  promise: Promise<void>;
  cancel(): void;
}

interface PdfPage {
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }): PdfRenderTask;
  cleanup(): void;
}

interface PdfDocument {
  numPages: number;
  getPage(number: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

type PdfLib = {
  getDocument(options: { data: Uint8Array }): { promise: Promise<PdfDocument> };
  GlobalWorkerOptions: { workerSrc: string };
};

/**
 * Render the document's first pages. Returns null when the document cannot
 * be opened at all (encrypted, malformed) — the caller shows the error
 * pane; pages that fail individually are simply omitted.
 */
export async function renderPdfPages(bytes: Uint8Array): Promise<PdfPageResult | null> {
  let pdfjs: PdfLib;
  try {
    // The worker is a separate build artifact; Vite resolves this URL form
    // and ships the file alongside the bundle.
    const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
    pdfjs = (await import("pdfjs-dist")) as unknown as PdfLib;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.href;
  } catch {
    return null;
  }

  let doc: PdfDocument | null = null;
  try {
    const loading = pdfjs.getDocument({ data: bytes });
    doc = await loading.promise;
    const pageCount = doc.numPages;
    const pages: string[] = [];
    const wanted = Math.min(MAX_PAGES, pageCount);
    for (let number = 1; number <= wanted; number += 1) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const canvas = document.createElement("canvas");
      canvas.width = PAGE_WIDTH;
      canvas.height = Math.round((PAGE_WIDTH / viewport.width) * viewport.height);
      const context = canvas.getContext("2d");
      if (!context) continue;
      await page.render({ canvasContext: context, viewport: canvas as never }).promise;
      pages.push(canvas.toDataURL("image/jpeg", PAGE_QUALITY));
      page.cleanup();
    }
    return { pages, pageCount };
  } catch {
    // A document that opens but fails to render still shows its page count
    // through the caller's error path; nothing here may throw.
    return null;
  } finally {
    void doc?.destroy();
  }
}
