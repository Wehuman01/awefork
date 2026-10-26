<template>
  <!--
    The canvas overview trigger (画布会话总览): one floating pill above the
    canvas with the three numbers that make the user look — running, waiting on
    me, new results. It reads counts only; the panel does the listing. Zero
    states stay clickable so the panel can still be opened on a quiet day.
  -->
  <div class="overview-trigger" :class="{ expanded: store.overview.open }">
    <button
      type="button"
      class="trigger-name"
      :aria-expanded="store.overview.open"
      aria-controls="session-overview-float"
      :title="store.overview.open ? t('overview.collapse') : t('overview.expand')"
      @click="toggleOverview()"
    >
      <span aria-hidden="true">▦</span>
      {{ t("overview.label") }}
    </button>
    <button
      v-if="settings.labs.overview.showRunning"
      type="button"
      class="trigger-stat running"
      :aria-expanded="store.overview.open"
      aria-controls="session-overview-float"
      :title="t('overview.runningCount', { n: stats.running })"
      @click="showOverviewStatus('running')"
    >
      <i aria-hidden="true"></i>
      {{ t("overview.running") }}
      <b>{{ stats.running }}</b>
    </button>
    <button
      v-if="settings.labs.overview.showWaiting"
      type="button"
      class="trigger-stat waiting"
      :aria-expanded="store.overview.open"
      aria-controls="session-overview-float"
      :title="t('overview.waitingCount', { n: stats.waiting })"
      @click="showOverviewStatus('waiting')"
    >
      <span class="wait-glyph" aria-hidden="true">?</span>
      {{ t("overview.waiting") }}
      <b>{{ stats.waiting }}</b>
    </button>
    <button
      v-if="settings.labs.overview.showUnread"
      type="button"
      class="trigger-stat unread"
      :aria-expanded="store.overview.open"
      aria-controls="session-overview-float"
      :title="t('overview.unreadCount', { n: stats.unread })"
      @click="showOverviewStatus('unread')"
    >
      <i aria-hidden="true"></i>
      {{ t("overview.unread") }}
      <b>{{ stats.unread }}</b>
    </button>
    <button
      type="button"
      class="trigger-chevron"
      :aria-expanded="store.overview.open"
      aria-controls="session-overview-float"
      :title="store.overview.open ? t('overview.collapse') : t('overview.expand')"
      @click="toggleOverview()"
    >{{ store.overview.open ? "⌃" : "⌄" }}</button>
  </div>
</template>

<script setup lang="ts">
import { t } from "../i18n";
import { settings } from "../settings";
import { overviewStats, showOverviewStatus, store, toggleOverview } from "../state";

/**
 * Counts come from the same computed the panel lists from, so the trigger and
 * the tabs can never disagree. `overviewStats` covers every agent this window
 * can see, not just the canvas's current project.
 */
const stats = overviewStats;
</script>
