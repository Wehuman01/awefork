<template>
  <header class="topbar">
    <div class="brand">
      <img class="logo" :src="logoUrl" alt="" />
      <span class="brand-name">awefork</span>
      <span class="brand-sub">{{ t("topbar.brandSub") }}</span>
    </div>
    <div v-if="backendList.length > 1" class="backend-wrap">
      <button
        type="button"
        class="backend-pill"
        :aria-expanded="backendOpen"
        aria-haspopup="menu"
        :aria-label="t('topbar.backends')"
        :title="t('topbar.switchBackend', { label: activeLabel })"
        @click.stop="toggleBackendMenu"
      >
        <span aria-hidden="true">🤖</span>
        <b>{{ activeLabel }}</b>
        <!-- The install probe's compat check: a CLI version outside the tested
             range still runs, but never silently — the full text sits in the
             title so one hover explains a misbehaving run. -->
        <span v-if="activeVersionWarning" class="backend-warn" :title="activeVersionWarning" role="status">⚠</span>
        <span class="chev">{{ backendOpen ? "▾" : "▸" }}</span>
      </button>
      <div v-if="backendOpen" class="backend-menu" role="menu" :aria-label="t('topbar.backends')">
        <button
          v-for="entry in backendList"
          :key="entry.id"
          type="button"
          role="menuitem"
          class="backend-item"
          :class="{ active: entry.id === activeBackend }"
          :disabled="!entry.installed"
          :title="
            entry.installed
              ? t('topbar.switchToWithWindow', { label: entry.label })
              : t('topbar.notOnPath', { label: entry.label })
          "
          @click="pickBackend(entry.id)"
        >
          <span class="backend-check" aria-hidden="true">{{ entry.id === activeBackend ? "✓" : "" }}</span>
          <span class="backend-name">{{ entry.label }}</span>
          <span v-if="entry.versionWarning" class="backend-warn" :title="entry.versionWarning">⚠</span>
        </button>
      </div>
    </div>
    <div v-if="directories.length > 0" class="project-wrap">
      <button type="button" class="project-pill" @click.stop="toggleOpen">
        <span>📁</span>
        <b>{{ shortPath(currentDirectory) }}</b>
        <span class="chev">{{ open ? "▾" : "▸" }}</span>
      </button>
      <div v-if="open" class="project-menu">
        <button
          v-for="directory in directories"
          :key="directory"
          type="button"
          class="project-item"
          :class="{ active: directory === currentDirectory }"
          :title="directory"
          @click="pick(directory)"
        >
          📁 {{ shortPath(directory) }}
        </button>
      </div>
    </div>
    <div class="topbar-status" :class="connectionError ? 'bad' : 'ok'">
      <span class="status-dot"></span>
      {{ connectionError ? t("topbar.disconnected", { label: activeLabel }) : t("topbar.connected", { label: activeLabel }) }}
    </div>
    <button
      type="button"
      class="icon-btn multiwindow-btn"
      :class="{ on: multiWindow }"
      role="switch"
      :aria-checked="multiWindow"
      :title="multiWindow ? t('topbar.multiWindowOn') : t('topbar.multiWindowOff')"
      @click="toggleMultiWindow"
    >
      <span class="multiwindow-track" aria-hidden="true"><span class="multiwindow-knob"></span></span>
      {{ t("topbar.multiWindowLabel") }}
    </button>
    <button
      type="button"
      class="icon-btn cmdk-btn"
      :title="t('topbar.commandPalette')"
      @click="togglePalette()"
    >{{ paletteKeyLabel }}</button>
    <button
      type="button"
      class="icon-btn cmdk-btn"
      :title="theme === 'dark' ? t('topbar.themeOff') : t('topbar.themeOn')"
      @click="toggleTheme"
    >{{ theme === "dark" ? "☀" : "☾" }}</button>
    <button
      type="button"
      class="icon-btn multiwindow-btn"
      :class="{ on: quitKeepAlive }"
      role="switch"
      :aria-checked="quitKeepAlive"
      :title="quitKeepAlive ? t('topbar.quitKeepAliveOn') : t('topbar.quitKeepAliveOff')"
      @click="toggleQuitKeepAlive"
    >
      <span class="multiwindow-track" aria-hidden="true"><span class="multiwindow-knob"></span></span>
      {{ t("topbar.quitKeepAliveLabel") }}
    </button>
    <div class="lang-switch" role="group" aria-label="Language">
      <button
        type="button"
        class="lang-btn"
        :class="{ on: locale === 'zh' }"
        :aria-pressed="locale === 'zh'"
        title="中文"
        @click="setLocale('zh')"
      >中</button>
      <button
        type="button"
        class="lang-btn"
        :class="{ on: locale === 'en' }"
        :aria-pressed="locale === 'en'"
        title="English"
        @click="setLocale('en')"
      >EN</button>
    </div>
    <HistoryButton />
    <div class="version-wrap" @click.stop>
      <button type="button" class="version-btn" @click="toggleVersionMenu">
        <span>{{ versionLabel }}</span>
        <span class="version-chev">▾</span>
      </button>
      <div v-if="versionOpen" class="version-menu">
        <button type="button" class="version-item" @click="runManualCheck">Check for updates</button>
      </div>
    </div>

    <!-- Switching backends reshapes the whole workspace, so every pick — in
         either multi-window mode — confirms first instead of acting on the
         click alone. -->
    <div
      v-if="pendingBackend"
      class="interaction-backdrop"
      role="presentation"
      @click="cancelBackendSwitch"
    >
      <section
        class="interaction-dialog backend-confirm"
        role="dialog"
        aria-modal="true"
        :aria-label="t('topbar.confirmKicker')"
        @click.stop
      >
        <p class="interaction-kicker">{{ t("topbar.confirmKicker") }}</p>
        <h2>{{ confirmTitle }}</h2>
        <ul class="compress-points">
          <li>{{ confirmPoint1 }}</li>
          <li>{{ t(multiWindow ? "topbar.confirmOpenPoint2" : "topbar.confirmSwitchPoint2") }}</li>
        </ul>
        <div class="interaction-actions">
          <button type="button" class="interaction-deny" @click="cancelBackendSwitch">
            {{ t("topbar.confirmCancel") }}
          </button>
          <button type="button" class="interaction-allow" @click="confirmBackendSwitch">
            {{ t(multiWindow ? "topbar.confirmOpen" : "topbar.confirmSwitch") }}
          </button>
        </div>
        <p class="interaction-timeout">{{ t("topbar.confirmEsc") }}</p>
      </section>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { BackendId } from "../../../shared/backend";
import logoUrl from "../assets/logo.svg";
import { shortPath } from "../format";
import { locale, setLocale, t } from "../i18n";
import { togglePalette } from "../layout";
import { modWith } from "../platform-key";
import {
  checkForUpdates,
  directories,
  openAgentWindow,
  refreshBackendList,
  store,
  switchBackend,
  switchDirectory,
} from "../state";
import { theme, toggleTheme } from "../theme";
import HistoryButton from "./history-button.vue";

const open = ref(false);
const versionOpen = ref(false);
const backendOpen = ref(false);
// Shared through localStorage so the preference survives restarts and applies
// to every window — new agent windows open by the main process read it at
// their own boot.
const multiWindow = ref(localStorage.getItem("awefork:multiWindow") === "1");
function toggleMultiWindow(): void {
  multiWindow.value = !multiWindow.value;
  localStorage.setItem("awefork:multiWindow", multiWindow.value ? "1" : "0");
}
// Quit keep-alive lives in main's settings.json (the quit dialog's checkbox
// also writes it), so this toggle is a plain IPC call — demo mode has no
// bridge and keeps the switch inert at its persisted default.
const quitKeepAlive = ref(false);
function toggleQuitKeepAlive(): void {
  if (!window.awefork) return;
  quitKeepAlive.value = !quitKeepAlive.value;
  void window.awefork.setQuitKeepAlive(quitKeepAlive.value);
}
void window.awefork?.quitKeepAlive().then((value) => {
  quitKeepAlive.value = value;
});
const currentDirectory = computed(() => store.selectedDirectory ?? "");
const connectionError = computed(() => store.connectionError);
const backendList = computed(() => store.backendList);
const activeBackend = computed(() => store.activeBackend);
const activeVersionWarning = computed(
  () => backendList.value.find((entry) => entry.id === activeBackend.value)?.versionWarning ?? null,
);
const activeLabel = computed(
  () =>
    backendList.value.find((entry) => entry.id === activeBackend.value)?.label ??
    activeBackend.value,
);
// The version button is always there (so manual checks stay reachable); a
// placeholder stands in until the first check fills the real version in.
const versionLabel = computed(() => `v${store.currentVersion ?? "—"}`);
// The palette shortcut shows the platform's own modifier: ⌘ on a Mac, Ctrl elsewhere.
const paletteKeyLabel = modWith("K");

function toggleOpen(): void {
  open.value = !open.value;
}

function toggleVersionMenu(): void {
  versionOpen.value = !versionOpen.value;
}

function toggleBackendMenu(): void {
  backendOpen.value = !backendOpen.value;
  // A CLI installed or removed since boot shows up here instead of after a
  // restart; the probe runs while the menu is already open.
  if (backendOpen.value) void refreshBackendList();
}

const pendingBackend = ref<BackendId | null>(null);
const confirmTitle = computed(() =>
  t(multiWindow.value ? "topbar.confirmOpenTitle" : "topbar.confirmSwitchTitle", {
    label: backendLabel(pendingBackend.value),
  }),
);
const confirmPoint1 = computed(() =>
  t(multiWindow.value ? "topbar.confirmOpenPoint1" : "topbar.confirmSwitchPoint1", {
    label: backendLabel(pendingBackend.value),
    current: activeLabel.value,
  }),
);

function backendLabel(backend: BackendId | null): string {
  return backendList.value.find((entry) => entry.id === backend)?.label ?? backend ?? "";
}

async function pickBackend(backend: BackendId): Promise<void> {
  backendOpen.value = false;
  pendingBackend.value = backend;
}

function cancelBackendSwitch(): void {
  pendingBackend.value = null;
}

async function confirmBackendSwitch(): Promise<void> {
  const backend = pendingBackend.value;
  pendingBackend.value = null;
  if (!backend) return;
  // One switch, two behaviors: off = the in-place switch the app has always
  // had; on = every pick focuses (or opens) that agent's dedicated window.
  if (multiWindow.value) {
    await openAgentWindow(backend);
    return;
  }
  await switchBackend(backend);
}

async function pick(directory: string): Promise<void> {
  open.value = false;
  await switchDirectory(directory);
}

async function runManualCheck(): Promise<void> {
  versionOpen.value = false;
  await checkForUpdates("manual");
}

function closeOnOutsideClick(): void {
  open.value = false;
  versionOpen.value = false;
  backendOpen.value = false;
}

function closeOnEscape(event: KeyboardEvent): void {
  if (event.key === "Escape") pendingBackend.value = null;
}

onMounted(() => {
  document.addEventListener("click", closeOnOutsideClick);
  document.addEventListener("keydown", closeOnEscape);
});
onUnmounted(() => {
  document.removeEventListener("click", closeOnOutsideClick);
  document.removeEventListener("keydown", closeOnEscape);
});
</script>
