import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { dialog, type IpcMainInvokeEvent, ipcMain } from "electron";

/**
 * "Save generated text as a file" — the renderer has no Node access, so a
 * branch's Markdown export lands here: native save dialog, then a plain
 * write. Registered from main/index.ts next to registerIpc; kept in its own
 * module because it is renderer-generic (no backend/adapter involvement).
 */
export function registerSaveFileIpc(): void {
  ipcMain.handle(
    "awefork:saveTextFile",
    async (_event: IpcMainInvokeEvent, defaultName: unknown, content: unknown) => {
      if (typeof defaultName !== "string" || typeof content !== "string" || !content) {
        throw new Error("saveTextFile 需要文件名与内容");
      }
      // The dialog's defaultPath takes the whole path; only the base name is
      // ours to suggest, so a crafted name can't point the dialog elsewhere.
      const name = basename(defaultName).trim() || "untitled.md";
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: name,
      });
      if (canceled || !filePath) return { ok: false };
      try {
        await writeFile(filePath, content, "utf8");
        return { ok: true, path: filePath };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
}
