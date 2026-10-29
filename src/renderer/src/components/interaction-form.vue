<template>
  <div class="interaction-form">
    <label v-for="field in fields" :key="field.key" class="interaction-field">
      <b>{{ fieldLabel(field) }}</b>
      <span v-if="field.description" class="interaction-field-hint">{{ field.description }}</span>

      <template v-if="field.type === 'external'">
        <!-- An external field's URL comes from the agent, so it is untrusted:
             a `javascript:` href would execute in the renderer's main world
             (where window.awefork lives) on click. Only http/https/mailto
             pass — the same gate ipc's openExternal applies — and the link
             routes through it rather than a raw href. -->
        <a
          v-if="isSafeExternalUrl(field.url)"
          class="interaction-field-link"
          :href="field.url"
          target="_blank"
          rel="noreferrer"
          @click.prevent="openExternal(field.url)"
        >
          {{ field.url }}
        </a>
        <span v-else class="interaction-field-link">{{ field.url }}</span>
      </template>

      <template v-else-if="field.type === 'boolean'">
        <input v-model="answers[field.key]" type="checkbox" />
      </template>

      <template v-else-if="field.type === 'multiselect'">
        <span v-for="option in field.options" :key="option.value" class="interaction-option">
          <input
            type="checkbox"
            :value="option.value"
            :checked="hasChoice(field.key, option.value)"
            @change="toggleChoice(field.key, option.value)"
          />
          {{ t(option.label) }}
        </span>
      </template>

      <template v-else-if="field.type === 'string' && field.options?.length">
        <select v-model="answers[field.key]">
          <option disabled value="">{{ t("form.pleaseSelect") }}</option>
          <option v-for="option in field.options" :key="option.value" :value="option.value">
            {{ t(option.label) }}
          </option>
          <option v-if="field.custom" :value="CUSTOM">{{ t("form.other") }}</option>
        </select>
        <input
          v-if="field.custom && answers[field.key] === CUSTOM"
          v-model="custom[field.key]"
          type="text"
          :placeholder="t('form.pleaseEnter')"
        />
      </template>

      <template v-else>
        <input
          v-model="answers[field.key]"
          :type="inputType(field)"
          :placeholder="field.type === 'string' ? field.placeholder : undefined"
        />
      </template>
    </label>

    <p v-if="validationError" class="interaction-form-error">{{ validationError }}</p>
  </div>
</template>

<script setup lang="ts">
import { type DeepReadonly, reactive, ref, watch } from "vue";
import type { AgentFormField } from "../../../shared/types";
import { t } from "../i18n";

/**
 * The fields as components actually hold them: deep-readonly straight out of
 * the store. The reactive answer map is written by key, so the read-only view
 * of the field metadata is all this component ever needs.
 */
type ReadonlyField = DeepReadonly<AgentFormField>;

const props = defineProps<{ fields: readonly ReadonlyField[] }>();

/** The schemes an external link may carry — ipc's openExternal gate, mirrored. */
const SAFE_URL_SCHEMES = ["http:", "https:", "mailto:"];

/**
 * Whether one external field's url is safe to render as a link. The value
 * comes from the agent, so a `javascript:` (or any other) href would execute
 * in the renderer's main world on click — where window.awefork lives.
 */
function isSafeExternalUrl(url: string): boolean {
  try {
    return SAFE_URL_SCHEMES.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** Open a safe external link through main's gated openExternal. */
function openExternal(url: string): void {
  if (!isSafeExternalUrl(url)) return;
  void window.awefork?.openExternal?.(url);
}

/**
 * Field values, keyed by field key. A form's answer map is heterogeneous —
 * text, numbers, booleans, string arrays — so this is `unknown` and the
 * submit step narrows per field type. External fields yield no answer and are
 * never seeded here.
 */
const answers = reactive<Record<string, unknown>>({});
/** Free-text values for fields whose `custom` option the user picked. */
const custom = reactive<Record<string, string>>({});
const validationError = ref("");

/** Sentinel select value meaning "the user chose to type their own answer". */
const CUSTOM = "__custom__";

function seed(): void {
  for (const key of Object.keys(answers)) delete answers[key];
  for (const key of Object.keys(custom)) delete custom[key];
  validationError.value = "";
  for (const field of props.fields) {
    if (field.type === "external") continue;
    if (field.type === "multiselect") {
      answers[field.key] = field.default ? [...field.default] : [];
      continue;
    }
    if (field.type === "boolean") {
      answers[field.key] = field.default ?? false;
      continue;
    }
    // A field with no default starts empty so a required one must be filled;
    // number/integer keep "" and are parsed on collect.
    answers[field.key] = field.default ?? "";
  }
}

watch(() => props.fields, seed, { immediate: true });

function fieldLabel(field: ReadonlyField): string {
  if (field.title) {
    const label = t(field.title);
    return field.type !== "external" && field.required ? `${label} *` : label;
  }
  return field.type === "external" ? field.url : field.key;
}

function inputType(field: ReadonlyField): string {
  if (field.type === "number" || field.type === "integer") return "number";
  if (field.type === "string") {
    if (field.format === "email") return "email";
    if (field.format === "uri") return "url";
    if (field.format === "date") return "date";
    if (field.format === "date-time") return "datetime-local";
  }
  return "text";
}

function hasChoice(key: string, value: string): boolean {
  return Array.isArray(answers[key]) && (answers[key] as string[]).includes(value);
}

function toggleChoice(key: string, value: string): void {
  const current = Array.isArray(answers[key]) ? (answers[key] as string[]) : [];
  answers[key] = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
}

/**
 * Coerce the reactive answers into the wire shape: each field's own type,
 * external fields omitted. Returns false (with a message) when a required
 * field is empty or a number is out of range, so submit can be blocked
 * before a doomed POST.
 */
function collect(): Record<string, string | number | boolean | string[]> | null {
  const out: Record<string, string | number | boolean | string[]> = {};
  for (const field of props.fields) {
    if (field.type === "external") continue;
    const raw = answers[field.key];
    if (field.type === "boolean") {
      out[field.key] = raw === true;
      continue;
    }
    if (field.type === "multiselect") {
      const selected = Array.isArray(raw) ? (raw as string[]) : [];
      if (field.required && selected.length === 0) {
        validationError.value = t("form.selectAtLeastOne", { label: fieldLabel(field) });
        return null;
      }
      if (field.minItems !== undefined && selected.length < field.minItems) {
        validationError.value = t("form.selectAtLeastN", {
          label: fieldLabel(field),
          n: field.minItems,
        });
        return null;
      }
      if (field.maxItems !== undefined && selected.length > field.maxItems) {
        validationError.value = t("form.selectAtMostN", {
          label: fieldLabel(field),
          n: field.maxItems,
        });
        return null;
      }
      out[field.key] = selected;
      continue;
    }
    if (field.type === "number" || field.type === "integer") {
      const text = String(raw ?? "").trim();
      if (text === "") {
        if (field.required) {
          validationError.value = t("form.required", { label: fieldLabel(field) });
          return null;
        }
        continue;
      }
      const value = Number(text);
      if (!Number.isFinite(value) || (field.type === "integer" && !Number.isInteger(value))) {
        validationError.value = t(
          field.type === "integer" ? "form.enterInteger" : "form.enterNumber",
          { label: fieldLabel(field) },
        );
        return null;
      }
      if (field.minimum !== undefined && value < field.minimum) {
        validationError.value = t("form.minError", {
          label: fieldLabel(field),
          min: field.minimum,
        });
        return null;
      }
      if (field.maximum !== undefined && value > field.maximum) {
        validationError.value = t("form.maxError", {
          label: fieldLabel(field),
          max: field.maximum,
        });
        return null;
      }
      out[field.key] = value;
      continue;
    }
    // string — a "Other…" pick resolves to the free-text the user typed.
    const rawText = raw === CUSTOM ? (custom[field.key] ?? "") : String(raw ?? "");
    const text = rawText.trim();
    if (text === "") {
      if (field.required) {
        validationError.value = t("form.required", { label: fieldLabel(field) });
        return null;
      }
      continue;
    }
    out[field.key] = text;
  }
  validationError.value = "";
  return out;
}

/** The modal calls `collect` on submit: the validated answer map, or null. */
defineExpose({ collect });
</script>
