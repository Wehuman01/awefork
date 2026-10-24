import { defineComponent, h } from "vue";
import type { BackendId } from "../../../shared/backend";
import { t } from "../i18n";
import { installBackend, store } from "../state";

/**
 * One install button: "installing…" while its npm install runs, then a fresh
 * probe lands via installBackend's refresh. An installed CLI collapses it to
 * a checkmark so the row visibly settles.
 */
export const AgentInstallButton = defineComponent({
  name: "AgentInstallButton",
  props: { backend: { type: String as () => BackendId, required: true }, primary: Boolean },
  setup(props) {
    return () => {
      const entry = store.backendList.find((b) => b.id === props.backend);
      const installing = store.installingBackend === props.backend;
      if (entry?.installed) {
        return h("span", { class: "welcome-installed" }, "✓");
      }
      return h(
        "button",
        {
          type: "button",
          class: props.primary ? "interaction-allow" : "interaction-deny",
          disabled: store.installingBackend !== null,
          onClick: () => void installBackend(props.backend),
        },
        installing ? t("onboard.installing") : t("onboard.install"),
      );
    };
  },
});
