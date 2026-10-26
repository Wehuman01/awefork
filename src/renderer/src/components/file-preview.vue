<template>
  <div class="fp" :class="{ reading }" tabindex="0" @keydown.space.prevent="toggleReading">
    <template v-if="!preview">
      <p class="fp-empty">{{ t("files.previewEmpty") }}</p>
    </template>
    <template v-else-if="preview.status === 'loading'">
      <p class="fp-loading">{{ t("files.previewLoading") }}</p>
    </template>
    <template v-else>
      <div class="fp-head">
        <span class="fp-name" :title="preview.path">{{ nameOf(preview.path) }}</span>
        <span v-if="preview.status === 'text' && codeLang" class="fp-lang">{{ codeLang }}</span>
        <span v-else-if="kindLabel" class="fp-lang">{{ kindLabel }}</span>
        <span v-if="preview.status === 'text' && preview.truncated" class="fp-trunc" :title="t('files.truncatedTitle')">{{
          t("files.truncated")
        }}</span>
        <span v-if="imageSize" class="fp-lang" :title="t('files.imageSizeTitle')">{{ imageSize }}</span>
        <span v-if="pdf" class="fp-lang">
          {{ t("files.pdfPages", { n: pdf.page + 1, total: pdf.pageCount }) }}
        </span>
        <button
          v-if="preview.status === 'image' && !imageBroken"
          type="button"
          class="fp-open"
          :title="t('files.zoomOut')"
          :aria-label="t('files.zoomOut')"
          :disabled="imageScale <= 1"
          @click="stepImageZoom(-1)"
          >−</button
        >
        <span v-if="preview.status === 'image' && !imageBroken" class="fp-zoom-pct">{{
          Math.round(imageScale * 100)
        }}%</span>
        <button
          v-if="preview.status === 'image' && !imageBroken"
          type="button"
          class="fp-open"
          :title="t('files.zoomIn')"
          :aria-label="t('files.zoomIn')"
          :disabled="imageScale >= 4"
          @click="stepImageZoom(1)"
          >＋</button
        >
        <button
          v-if="preview.status !== 'error' && !imageBroken && !standalone"
          type="button"
          class="fp-open"
          :class="{ on: reading }"
          :title="reading ? t('files.unzoom') : t('files.zoom')"
          :aria-label="reading ? t('files.unzoom') : t('files.zoom')"
          :aria-pressed="reading"
          @click="toggleReading"
          >⤢</button
        >
        <button
          v-if="canQuote"
          type="button"
          class="fp-open"
          :title="t('files.quoteToDraft')"
          :aria-label="t('files.quoteToDraft')"
          @click="quoteToDraft"
          >❝</button
        >
        <button type="button" class="fp-open" :title="t('files.openSystem')" @click="openSystem">↗</button>
        <button
          type="button"
          class="fp-open"
          :title="t('files.closePreview')"
          :aria-label="t('files.closePreview')"
          @click="standalone ? emit('close') : clearPreview()"
          >✕</button
        >
      </div>
      <div
        v-if="preview.status === 'image' && !imageBroken"
        ref="imageWrapEl"
        class="fp-image-wrap"
        :class="{ zoomed: imageScale > 1 }"
        @wheel.ctrl.prevent="onImageWheel"
      >
        <img
          ref="imageEl"
          class="fp-image"
          :src="preview.dataUrl"
          :alt="preview.path"
          :style="{ width: imageScale > 1 ? `${imageScale * 100}%` : undefined }"
          @load="onImageLoad"
          @error="imageBroken = true"
        />
      </div>
      <div v-else-if="pdf" class="fp-pdf">
        <img v-if="pdf.pages[pdf.page]" class="fp-pdf-page" :src="pdf.pages[pdf.page]" :alt="pdf.path" />
        <p v-else class="fp-state">{{ t("files.pdfRenderFailed") }}</p>
        <div v-if="pdf.pageCount > 1" class="fp-pdf-nav">
          <button
            type="button"
            class="fp-open"
            :disabled="pdf.page === 0"
            :title="t('files.pdfPrevPage')"
            :aria-label="t('files.pdfPrevPage')"
            @click="turnPage(-1)"
            >‹</button
          >
          <span class="fp-pdf-count">{{ pdf.page + 1 }} / {{ pdf.pageCount }}</span>
          <button
            type="button"
            class="fp-open"
            :disabled="pdf.page >= pdf.pageCount - 1"
            :title="t('files.pdfNextPage')"
            :aria-label="t('files.pdfNextPage')"
            @click="turnPage(1)"
            >›</button
          >
        </div>
      </div>
      <template v-else-if="preview.status === 'text'">
        <div v-if="csvTable" class="fp-csv">
          <table class="fp-csv-table">
            <thead>
              <tr>
                <th v-for="(cell, i) in csvTable.head" :key="i">{{ cell }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, r) in csvTable.rows" :key="r">
                <td v-for="(cell, c) in row" :key="c">{{ cell }}</td>
              </tr>
            </tbody>
          </table>
          <p class="fp-csv-note">{{ t("files.csvNote", { cols: csvTable.cols, rows: csvTable.total }) }}</p>
        </div>
        <MarkdownView v-else-if="isMarkdown" class="fp-markdown" :source="preview.text ?? ''" />
        <div v-else class="fp-code">
          <pre><code><span v-for="(line, i) in lines" :key="i" class="fp-line"><span class="fp-ln">{{ i + 1 }}</span><span class="fp-text">{{ line }}</span></span></code></pre>
        </div>
      </template>
      <div v-else class="fp-error">
        <p class="fp-error-title">{{ imageBroken ? t("files.errImageDecode") : errorText }}</p>
        <p class="fp-error-sub">{{ preview.path }}</p>
        <button
          v-if="canOpen"
          type="button"
          class="fp-open-btn"
          :title="t('files.openSystem')"
          @click="openSystem"
          >{{ t("files.openSystem") }}</button
        >
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { displayName } from "../../../shared/file-paths";
import { clearPreview, flashNotice, type PreviewState } from "../files";
import { t } from "../i18n";
import { insertDraftText, store } from "../state";
import { MarkdownView } from "./markdown-view";

const props = defineProps<{
  preview: PreviewState | null;
  /** Reading mode lives on the tab; the pane only reflects and toggles it. */
  reading: boolean;
  /**
   * Standalone: the pane is the middle column's whole content (the
   * no-browser layout), not a browser tab's side pane. Reading mode has
   * nothing to fold away there, so its toggle is hidden and ✕ asks the
   * shell to close instead of clearing a tab's preview.
   */
  standalone?: boolean;
}>();

const emit = defineEmits<{ "toggle-reading": []; close: [] }>();

const preview = computed(() => props.preview);
const reading = computed(() => props.reading);

/** The pdf view narrowed to its required fields, for the template. */
const pdf = computed(() => {
  const p = props.preview;
  if (p?.status !== "pdf" || p.pages === undefined || p.pageCount === undefined) return null;
  // Only the first pages are rasterized (pdf-preview.ts), so the toolbar
  // walks the rendered ones: paging past them would show the "could not be
  // rendered" pane for a page that was never asked for. The full document
  // is one system-open away.
  const rendered = Math.min(p.pageCount, p.pages.length);
  return { pages: p.pages, page: p.page ?? 0, pageCount: rendered, path: p.path };
});

function toggleReading(): void {
  emit("toggle-reading");
}

/**
 * The bytes read fine but the browser could not decode them (a corrupt PNG,
 * an extension that lies about its format). That is not a read error, so it
 * is tracked here and shown through the error pane, which offers system open.
 * The preview object is a fresh one on every request — re-clicking the same
 * file after fixing it must clear the mark, so the watch keys on identity,
 * not on the path (which would not change).
 */
const imageBroken = ref(false);
watch(
  () => props.preview,
  () => {
    imageBroken.value = false;
    imageScale.value = 1;
    // The badge describes the image that just loaded; a text, CSV or PDF
    // preview must not inherit the previous file's pixel size.
    imageSize.value = "";
  },
);

/** Zoom for images: 1..4 in doubling steps, ctrl+wheel inside the frame. */
const imageScale = ref(1);

function stepImageZoom(direction: number): void {
  const next = Math.min(4, Math.max(1, imageScale.value + direction));
  imageScale.value = next;
}

function onImageWheel(event: WheelEvent): void {
  stepImageZoom(event.deltaY < 0 ? 1 : -1);
}

/** Original pixel size, read once the <img> has decoded. */
const imageSize = ref("");
const imageEl = ref<HTMLImageElement | null>(null);
const imageWrapEl = ref<HTMLDivElement | null>(null);

function onImageLoad(): void {
  const img = imageEl.value;
  if (!img?.naturalWidth) {
    imageSize.value = "";
    return;
  }
  imageSize.value = `${img.naturalWidth}×${img.naturalHeight}`;
}

const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdown"];
const CODE_EXTENSIONS: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".vue": "Vue",
  ".json": "JSON",
  ".css": "CSS",
  ".scss": "SCSS",
  ".less": "LESS",
  ".html": "HTML",
  ".htm": "HTML",
  ".svg": "SVG",
  ".py": "Python",
  ".rb": "Ruby",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".swift": "Swift",
  ".c": "C",
  ".h": "C",
  ".cc": "C++",
  ".cpp": "C++",
  ".hpp": "C++",
  ".cs": "C#",
  ".php": "PHP",
  ".sh": "Shell",
  ".bash": "Shell",
  ".zsh": "Shell",
  ".yml": "YAML",
  ".yaml": "YAML",
  ".toml": "TOML",
  ".xml": "XML",
  ".sql": "SQL",
  ".lua": "Lua",
  ".dart": "Dart",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".erl": "Erlang",
  ".clj": "Clojure",
  ".hs": "Haskell",
  ".ml": "OCaml",
};

const CSV_EXTENSIONS = [".csv", ".tsv"];

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return dot > slash ? path.slice(dot).toLowerCase() : "";
}

const isMarkdown = computed(() =>
  MARKDOWN_EXTENSIONS.includes(extensionOf(preview.value?.path ?? "")),
);
const codeLang = computed(() => CODE_EXTENSIONS[extensionOf(preview.value?.path ?? "")] ?? "");

/** Badge for the non-text kinds that now have their own renderers. */
const kindLabel = computed(() => {
  if (preview.value?.status === "image") return t("files.kindImage");
  if (preview.value?.status === "pdf") return t("files.kindPdf");
  if (preview.value?.status === "text" && CSV_EXTENSIONS.includes(extensionOf(preview.value.path)))
    return t("files.kindCsv");
  return "";
});

/** Lines for the code view; markdown takes the MarkdownView route instead. */
const lines = computed(() => (preview.value?.text ?? "").split("\n"));

/**
 * CSV/TSV as a table: a quoted-field-aware split of the first rows. The
 * preview text is already bounded, so the table is bounded with it; the
 * note says how many rows the whole file has beyond what is shown.
 */
const csvTable = computed(() => {
  const text = preview.value?.text;
  if (preview.value?.status !== "text" || text === undefined) return null;
  const ext = extensionOf(preview.value.path);
  if (!CSV_EXTENSIONS.includes(ext)) return null;
  const delimiter = ext === ".tsv" ? "\t" : ",";
  const rows = splitRows(text, delimiter);
  const head = rows[0];
  if (head === undefined) return null;
  return {
    head,
    rows: rows.slice(1, 101),
    cols: head.length,
    // Data rows in the previewed text — the header is the head, not a row.
    total: rows.length - 1,
  };
});

/** RFC-4180-ish: quotes may contain the delimiter and escaped quotes. */
function splitRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell !== ""));
}

function turnPage(delta: number): void {
  const p = preview.value;
  if (p?.status !== "pdf" || p.pages === undefined || p.pageCount === undefined) return;
  const current = p.page ?? 0;
  // Bounded by the pages actually rendered, which the toolbar's disabled
  // state already reflects — this is the guard for a key or a stale click.
  const last = Math.min(p.pageCount, p.pages.length) - 1;
  const next = Math.min(last, Math.max(0, current + delta));
  if (next === current) return;
  // The rendered pages live on the preview object; a shallow copy keeps the
  // reactive readers (page indicator, <img>) in sync without re-rendering.
  Object.assign(p, { page: next });
}

const errorText = computed(() => {
  const error = preview.value?.error;
  switch (error?.code) {
    case "not-found":
      return t("files.errNotFound");
    case "permission":
      return t("files.errPermission");
    case "too-large":
      return t("files.errTooLarge");
    case "not-a-directory":
      return t("files.errNotADirectory");
    case "binary":
      return t("files.errBinary");
    default:
      return error?.message ? `${t("files.errUnknown")}：${error.message}` : t("files.errUnknown");
  }
});

/** The OS open is offered for anything that exists but we cannot render. */
const canOpen = computed(() => preview.value?.error?.code !== "not-found");

/** Quoting needs an open draft to land in — same rule as the context menu. */
const canQuote = computed(() => store.draft !== null && preview.value !== null);

function nameOf(path: string): string {
  return displayName(path);
}

function openSystem(): void {
  const path = preview.value?.path;
  if (!path) return;
  void window.awefork.openPath(path).then((result) => {
    if (!result.ok) flashNotice(t("files.openFailed"));
  });
}

/** Insert the path as text into the open draft; never sends anything. */
function quoteToDraft(): void {
  const path = preview.value?.path;
  if (!path) return;
  const result = insertDraftText(path);
  if (result.ok) {
    flashNotice(t("files.insertedDraft"));
    return;
  }
  flashNotice(result.reason === "sending" ? t("files.draftSending") : t("files.noDraftTarget"));
}
</script>
