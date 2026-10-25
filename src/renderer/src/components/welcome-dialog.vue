<template>
  <div
    v-if="store.onboardingVisible"
    class="interaction-backdrop"
    role="presentation"
    @click="skip"
  >
    <section
      class="interaction-dialog welcome-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="t('onboard.title')"
      @click.stop
    >
      <p class="interaction-kicker">{{ t("onboard.kicker") }}</p>
      <h2>{{ t("onboard.title") }}</h2>
      <p class="welcome-lede">{{ t("onboard.lede") }}</p>
      <ul class="welcome-agents">
        <li class="welcome-agent recommended">
          <div class="welcome-agent-text">
            <p class="welcome-agent-name">
              opencode
              <span class="welcome-agent-tag">{{ t("onboard.recommended") }}</span>
            </p>
            <p class="welcome-agent-desc">{{ t("onboard.desc.opencode") }}</p>
          </div>
          <AgentInstallButton backend="opencode" primary />
        </li>
        <li v-for="entry in others" :key="entry.id" class="welcome-agent">
          <div class="welcome-agent-text">
            <p class="welcome-agent-name">{{ entry.label }}</p>
            <p class="welcome-agent-desc">{{ t(`onboard.desc.${entry.id}`) }}</p>
          </div>
          <AgentInstallButton :backend="entry.id" />
        </li>
      </ul>
      <div class="interaction-actions">
        <button type="button" class="interaction-deny" @click="skip">{{ t("onboard.skip") }}</button>
      </div>
      <p class="interaction-timeout">{{ t("onboard.esc") }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { t } from "../i18n";
import { dismissOnboarding, store } from "../state";
import { AgentInstallButton } from "./agent-install-button";

// The non-recommended agents worth offering on first run: only the missing,
// one-click-installable ones — zcode ships with its desktop app, and an
// installed CLI needs nothing. claude code is npm-installable like codex and
// pi, so it belongs here; excluding it left `onboard.desc.claudecode` with no
// consumer and hid the one agent whose install button works.
const others = computed(() =>
  store.backendList.filter(
    (entry) => entry.id !== "opencode" && entry.id !== "zcode" && !entry.installed,
  ),
);

function skip(): void {
  void dismissOnboarding();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Escape" && store.onboardingVisible) {
    event.preventDefault();
    skip();
  }
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<style>
.welcome-dialog {
  max-width: 30rem;
}
.welcome-lede {
  margin: 0.25rem 0 0.9rem;
  color: var(--ink-2, #888);
  font-size: 0.85rem;
}
.welcome-agents {
  list-style: none;
  margin: 0 0 0.9rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.welcome-agent {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.9rem;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--line-1, #333);
  border-radius: 8px;
}
.welcome-agent.recommended {
  border-color: var(--accent-1, #4aa);
}
.welcome-agent-name {
  margin: 0;
  font-weight: 600;
}
.welcome-agent-tag {
  margin-left: 0.4rem;
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--accent-1, #4aa);
}
.welcome-agent-desc {
  margin: 0.15rem 0 0;
  font-size: 0.78rem;
  color: var(--ink-2, #888);
}
.welcome-installed {
  color: var(--ok, #3a3);
  font-weight: 700;
}
</style>
