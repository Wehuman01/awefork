/**
 * One place that knows how a missing CLI looks on each platform.
 *
 * On POSIX a spawn of an absent binary fails with ENOENT, which every
 * backend can surface directly. On Windows the npm `.cmd` shims need
 * `shell: true`, so the spawn is handed to cmd.exe: cmd reports a missing
 * command as exit code 9009 and the child's own ENOENT never reaches us.
 * The message text is locale-dependent, so the exit code is the only
 * reliable marker.
 *
 * The message carries an explicit "ENOENT" token on purpose — the backend
 * registry's missing-CLI early abort keys on that token, so a Windows user
 * with no CLI on PATH fails fast instead of walking every candidate port
 * or waiting out a spawn deadline.
 */

/** cmd.exe's exit code for "command not found". */
export const CMD_NOT_FOUND_EXIT_CODE = 9009;

/** True when a child's exit code is cmd.exe's "command not found". */
export function isCmdNotFound(exitCode: number | null | undefined): boolean {
  return exitCode === CMD_NOT_FOUND_EXIT_CODE;
}

/**
 * The error a backend throws when its CLI is missing on Windows. The wording
 * mirrors the POSIX ENOENT path so both platforms read the same to the user.
 */
export function missingCliMessage(cli: string, installHint: string): string {
  return `Could not start ${cli}: ENOENT (cmd exit ${CMD_NOT_FOUND_EXIT_CODE}). Is the "${cli}" CLI on PATH? ${installHint}`;
}
