import { createApp } from "vue";
// The preview reuses the app's real stylesheet so the mock pane renders in
// the exact visual language (bubbles, chips, thought blocks) it would ship in.
import "../style.css";
import SubagentPreview from "./subagent-preview.vue";

// Browser-only design preview served by `npm run demo` at
// /subagent-demo.html — never referenced from the Electron entry.
createApp(SubagentPreview).mount("#app");
