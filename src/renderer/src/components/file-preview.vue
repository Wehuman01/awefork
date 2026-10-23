<template>
  <div
    class="fp"
    :class="{ zoomed }"
    tabindex="0"
    @keydown.space.prevent="toggleZoom"
    @keydown.esc="zoomed = false"
  >
    <template v-if="!preview">
      <p class="fp-empty">{{ t("files.previewEmpty") }}</p>
    </template>
    <template v-else-if="preview.status === 'loading'">
      <p class="fp-loading">{{ t("files.previewLoading") }}</p>
    </template>
    <template v-else-if="preview.status === 'image'">
      <div class="fp-image-wrap">
        <img class="fp-image" :src="preview.dataUrl" :alt="preview.path" />
      </div>
    </template>
    <template v-else-if="preview.status === 'text'">
      <div class="fp-head">
        <span class="fp-name" :title="preview.path">{{ nameOf(preview.path) }}</span>
        <span v-if="codeLang" class="fp-lang">{{ codeLang }}</span>
        <span v-if="preview.truncated" class="fp-trunc" :title="t('files.truncatedTitle')">{{
          t("files.truncated")
        }}</span>
        <button
          type="button"
          class="fp-open"
          :class="{ on: zoomed }"
          :title="zoomed ? t('files.unzoom') : t('files.zoom')"
          :aria-label="zoomed ? t('files.unzoom') : t('files.zoom')"
          :aria-pressed="zoomed"
          @click="toggleZoom"
          >⤢</button
        >
        <button type="button" class="fp-open" :title="t('files.openSystem')" @click="openSystem">↗</button>
      </div>
      <MarkdownView v-if="isMarkdown" class="fp-markdown" :source="preview.text ?? ''" />
      <div v-else class="fp-code">
        <pre><code><span v-for="(line, i) in lines" :key="i" class="fp-line"><span class="fp-ln">{{ i + 1 }}</span><span class="fp-text">{{ line }}</span></span></code></pre>
      </div>
    </template>
    <template v-else>
      <div class="fp-error">
        <p class="fp-error-title">{{ errorText }}</p>
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
import { flashNotice, type PreviewState } from "../files";
import { t } from "../i18n";
import { MarkdownView } from "./markdown-view";

const props = defineProps<{ preview: PreviewState | null }>();

const preview = computed(() => props.preview);

/** Space (or the ⤢ button) enlarges the current preview; Esc steps back. */
const zoomed = ref(false);

function toggleZoom(): void {
  zoomed.value = !zoomed.value;
}

// A new file replaces the preview, so the enlargement cannot outlive it.
watch(
  () => props.preview?.path,
  () => {
    zoomed.value = false;
  },
);

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

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return dot > slash ? path.slice(dot).toLowerCase() : "";
}

const isMarkdown = computed(() =>
  MARKDOWN_EXTENSIONS.includes(extensionOf(preview.value?.path ?? "")),
);
const codeLang = computed(() => CODE_EXTENSIONS[extensionOf(preview.value?.path ?? "")] ?? "");

/** Lines for the code view; markdown takes the MarkdownView route instead. */
const lines = computed(() => (preview.value?.text ?? "").split("\n"));

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
</script>
