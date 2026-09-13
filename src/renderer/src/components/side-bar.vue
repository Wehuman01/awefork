<template>
  <aside class="sidebar">
    <div class="side-label">项目</div>
    <div class="side-actions">
      <button type="button" class="icon-btn wide" title="在当前项目里开一条新对话" @click="emitCreate">
        ＋ 新对话
      </button>
      <button type="button" class="icon-btn wide" title="重新加载会话" @click="emitRefresh">↻ 刷新</button>
    </div>
    <div class="search">
      <span>⌕</span>
      <input v-model="query" type="text" placeholder="搜索会话" aria-label="搜索会话" />
    </div>
    <div v-if="allTags.length > 0" class="tag-shelf-zone">
      <div id="tag-shelf" class="tag-shelf">
        <button
          v-for="tag in shelfTags"
          :key="tag"
          type="button"
          class="tag-filter"
          :class="{ on: activeTagFilters.includes(tag) }"
          :style="{ '--tag-c': tagColor(tag) }"
          :title="activeTagFilters.includes(tag) ? '点击取消这个筛选' : '只看带这个标签的会话'"
          @click="toggleTagFilter(tag)"
          @contextmenu.prevent="openShelfTagMenu(tag, $event)"
        >{{ activeTagFilters.includes(tag) ? "✓ " : "" }}{{ tag }}</button>
      </div>
      <button
        v-if="allTags.length > SHELF_PREVIEW"
        type="button"
        class="shelf-toggle"
        :aria-expanded="shelfShowAll"
        aria-controls="tag-shelf"
        @click="shelfExpanded = !shelfExpanded"
      >
        <span class="shelf-toggle-caret">{{ shelfShowAll ? "▾" : "▸" }}</span
        >{{ shelfShowAll ? "收起标签" : `还有 ${allTags.length - SHELF_PREVIEW} 个标签` }}
      </button>
    </div>
    <div v-if="favoriteSessions.length > 0 && !searching" class="fav-zone">
      <button
        type="button"
        class="fav-head"
        :aria-expanded="favOpen"
        aria-controls="favorite-list"
        @click="favOpen = !favOpen"
      >
        <span class="archive-caret">{{ favOpen ? "▾" : "▸" }}</span>
        <span>★ 收藏</span>
        <span class="proj-count">{{ favoriteSessions.length }}</span>
      </button>
      <div v-if="favOpen" id="favorite-list" class="fav-list">
        <button
          v-for="sess in favoriteSessions"
          :key="sess.id"
          type="button"
          class="fav-row"
          :class="{ active: sess.id === selectedId, running: store.running[sess.id] }"
          :title="sess.title || '(untitled)'"
          @click="openFavorite(sess)"
        >
          <span class="fav-dot"></span>
          <span class="fav-name">{{ sess.title || "(untitled)" }}</span>
          <span
            v-for="tag in rowTags(sess.id, 1).tags"
            :key="tag"
            class="tag-chip clickable"
            :style="{ color: tagColor(tag), background: tagBg(tag) }"
            title="只看带这个标签的会话"
            @click.stop="filterByTag(tag)"
          >{{ tag }}</span>
          <span
            v-if="rowTags(sess.id, 1).more > 0"
            class="tag-chip tag-more"
            :title="rowTags(sess.id, 1).hidden.join('、')"
          >+{{ rowTags(sess.id, 1).more }}</span>
          <span class="fav-dir">{{ shortPath(sess.directory) }}</span>
        </button>
      </div>
    </div>
    <nav class="session-list">
      <template v-for="group in visibleGroups" :key="group.directory">
        <div
          class="proj-row"
          :class="{ active: group.directory === selectedDirectory }"
          @contextmenu.prevent="openDirMenu(group.directory, $event)"
        >
          <button
            type="button"
            class="proj-caret"
            :title="isOpen(group) ? '收起这个目录' : '展开这个目录'"
            @click="toggleDir(group.directory)"
          >{{ isOpen(group) ? "▾" : "▸" }}</button>
          <button
            type="button"
            class="proj"
            :class="{ active: group.directory === selectedDirectory }"
            :title="group.directory"
            @click="selectDirectory(group.directory)"
          >
            <span>📁</span>
            <span class="proj-name">{{ shortPath(group.directory) }}</span>
            <span v-if="countSessions(group) > 0" class="proj-count">{{ countSessions(group) }}</span>
          </button>
        </div>
        <template v-if="isOpen(group)">
          <div
            v-for="row in flatSessions(group)"
            :key="row.session.id"
            class="sess-row"
            :class="{ active: row.session.id === selectedId }"
          >
            <input
              v-if="renaming?.sessionId === row.session.id"
              :ref="focusRenameInput"
              v-model="renameText"
              class="sess-rename"
              :style="{ marginLeft: `${8 + row.depth * 14}px` }"
              @keydown.enter="onRenameEnter"
              @keydown.esc.stop="onRenameEsc"
              @mousedown.stop
              @blur="commitRename"
            />
            <button
              v-else
              type="button"
              class="sess"
              :class="{
                running: store.running[row.session.id],
                recent: recentAlphaFor(row.session.id) > 0,
              }"
              :style="{
                paddingLeft: `${8 + row.depth * 14}px`,
                '--recent-alpha': recentAlphaFor(row.session.id),
              }"
              :title="row.session.title || '(untitled)'"
              @click="selectSession(row.session.id, { focus: true })"
              @contextmenu.prevent="openMenu(row.session, $event.clientX, $event.clientY)"
            >
              <span class="dot"></span>
              <span v-if="row.session.origin === 'fork'" class="fork-glyph">⎇</span>
              <span class="sess-name">{{ row.session.title || "(untitled)" }}</span>
              <span
                v-for="tag in rowTags(row.session.id, 2).tags"
                :key="tag"
                class="tag-chip clickable"
                :style="{ color: tagColor(tag), background: tagBg(tag) }"
                title="只看带这个标签的会话"
                @click.stop="filterByTag(tag)"
              >{{ tag }}</span>
              <span
                v-if="rowTags(row.session.id, 2).more > 0"
                class="tag-chip tag-more"
                :title="rowTags(row.session.id, 2).hidden.join('、')"
              >+{{ rowTags(row.session.id, 2).more }}</span>
            </button>
            <button
              type="button"
              class="pin-star"
              :class="{ on: store.pins.includes(row.session.id) }"
              :title="store.pins.includes(row.session.id) ? '取消收藏' : '收藏'"
              @click.stop="pinToggle(row.session.id)"
            >{{ store.pins.includes(row.session.id) ? "★" : "☆" }}</button>
            <button
              type="button"
              class="sess-archive"
              title="归档会话（在下方归档区可恢复）"
              @click.stop="rowArchive(row.session.id)"
            >📦</button>
          </div>
        </template>
      </template>
      <p v-if="visibleGroups.length === 0" class="group-empty">没有匹配的会话</p>
    </nav>

    <div class="archive-zone">
      <button
        type="button"
        class="archive-head"
        :aria-expanded="archiveOpen"
        aria-controls="archive-list"
        @click="archiveOpen = !archiveOpen"
      >
        <span class="archive-caret">{{ archiveOpen ? "▾" : "▸" }}</span>
        <span>📦 归档</span>
        <span v-if="archiveCount > 0" class="proj-count">{{ archiveCount }}</span>
      </button>
      <div v-if="archiveOpen" id="archive-list" class="archive-list">
        <div v-for="dir in archivedDirectoryViews" :key="`dir:${dir.path}`" class="arch-row">
          <span class="arch-name" :title="dir.path">📁 {{ shortPath(dir.path) }}</span>
          <span class="arch-count" :title="`${dir.hiddenCount} 个会话被隐藏`">{{ dir.hiddenCount }}</span>
          <button
            type="button"
            class="arch-restore"
            title="恢复这个目录（含以后新增的会话）"
            @click="onRestoreDirectory(dir.path)"
          >↩</button>
        </div>
        <div v-for="sess in archivedSessionViews" :key="`sess:${sess.id}`" class="arch-row">
          <span class="arch-name" :title="sess.title">{{ sess.title }}</span>
          <button
            type="button"
            class="arch-restore"
            title="恢复这个会话"
            @click="onRestoreSession(sess.id)"
          >↩</button>
        </div>
        <p v-if="archiveCount === 0" class="group-empty">归档区是空的</p>
      </div>
    </div>

    <div
      v-if="menu"
      class="ctx-menu"
      role="menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @mousedown.stop
      @keydown.tab="trapMenuTab"
    >
      <button type="button" role="menuitem" class="ctx-menu-item" @click="beginRename">✏️ 重命名</button>
      <button type="button" role="menuitem" class="ctx-menu-item" @click="openTagMenu">🏷 设置标签…</button>
      <button type="button" role="menuitem" class="ctx-menu-item" @click="copySessionId">📋 复制会话 ID</button>
      <button type="button" role="menuitem" class="ctx-menu-item" @click="openInTerminal">↗ 在终端中打开</button>
      <button type="button" role="menuitem" class="ctx-menu-item" @click="beginArchive">📦 归档会话</button>
      <button type="button" role="menuitem" class="ctx-menu-item danger" @click="beginDelete">
        🗑 删除会话…
      </button>
    </div>

    <div
      v-if="dirMenu"
      class="ctx-menu"
      role="menu"
      :style="{ left: `${dirMenu.x}px`, top: `${dirMenu.y}px` }"
      @mousedown.stop
      @keydown.tab="trapMenuTab"
    >
      <button type="button" role="menuitem" class="ctx-menu-item" @click="beginDirArchive">
        📦 归档这个目录…
      </button>
    </div>

    <div
      v-if="shelfTagMenu"
      class="ctx-menu tag-ctx"
      role="menu"
      :style="{ left: `${shelfTagMenu.x}px`, top: `${shelfTagMenu.y}px` }"
      @mousedown.stop
      @keydown.tab="trapMenuTab"
    >
      <div class="tag-del-confirm flat">
        <span class="tdc-text"
          >「{{ shelfTagMenu.tag }}」挂在 {{ tagCount(shelfTagMenu.tag) }} 个会话上</span
        >
        <div class="tdc-btns">
          <button
            type="button"
            class="tdc-btn danger"
            title="从所有会话删除这个标签（可撤销）"
            @click="confirmShelfDelete"
          >全部删除</button>
          <button type="button" class="tdc-btn" @click="shelfTagMenu = null">取消</button>
        </div>
      </div>
    </div>

    <div
      v-if="tagMenu"
      class="ctx-menu tag-menu"
      role="menu"
      :style="{ left: `${tagMenu.x}px`, top: `${tagMenu.y}px` }"
      @mousedown.stop
      @keydown.tab="trapMenuTab"
    >
      <div class="tag-menu-head">这个会话的标签</div>
      <div v-if="allTags.length > TAG_SEARCH_MIN" class="tag-menu-search">
        <span>⌕</span>
        <input
          v-model="tagSearch"
          type="text"
          placeholder="搜索标签"
          aria-label="搜索标签"
          @keydown.esc.stop="onTagMenuEsc"
        />
      </div>
      <div class="tag-menu-list" role="group" aria-label="标签列表">
        <template v-for="tag in menuTags" :key="tag">
          <label class="tag-opt">
            <input
              type="checkbox"
              :checked="draftTags.includes(tag)"
              @change="toggleDraftTag(tag)"
            />
            <span class="tag-chip" :style="{ color: tagColor(tag), background: tagBg(tag) }">{{
              tag
            }}</span>
            <span class="tag-count">{{ tagCount(tag) }}</span>
            <button
              type="button"
              class="tag-dot"
              :class="{ picked: tagColorPicked(tag) }"
              :style="{ background: tagColor(tag) }"
              :title="tagColorPicked(tag) ? '换个颜色（点 ✕ 恢复默认）' : '给这个标签选个颜色'"
              :aria-label="tagColorPicked(tag) ? `修改「${tag}」的颜色` : `给「${tag}」选个颜色`"
              @click.stop.prevent="toggleColorEdit(tag)"
            ></button>
            <button
              type="button"
              class="tag-del"
              :class="{ arming: delConfirm === tag }"
              title="删除这个标签"
              @click.stop.prevent="delConfirm = delConfirm === tag ? null : tag"
            >🗑</button>
          </label>
          <div v-if="delConfirm === tag" class="tag-del-confirm" @mousedown.stop>
            <span class="tdc-text">「{{ tag }}」挂在 {{ tagCount(tag) }} 个会话上</span>
            <div class="tdc-btns">
              <button
                v-if="draftTags.includes(tag)"
                type="button"
                class="tdc-btn"
                title="只从当前会话移除这个标签"
                @click="confirmDelLocal(tag)"
              >仅本会话移除</button>
              <button
                type="button"
                class="tdc-btn danger"
                title="从所有会话删除这个标签（可撤销）"
                @click="confirmDelAll(tag)"
              >全部删除</button>
              <button type="button" class="tdc-btn" @click="delConfirm = null">取消</button>
            </div>
          </div>
          <div v-if="colorEdit === tag" class="tag-palette" @mousedown.stop>
            <div class="pal-row">
              <button
                type="button"
                class="pal-swatch pal-auto"
                :class="{ picked: !tagColorPicked(tag) }"
                :style="{ '--auto-c': tagColor(tag) }"
                title="按名字自动配色"
                aria-label="按名字自动配色"
                @click="pickTagColor(tag, null)"
              ></button>
              <button
                v-for="hue in TAG_PALETTE"
                :key="hue"
                type="button"
                class="pal-swatch"
                :class="{ picked: tagColorPicked(tag) && hueOf(tag) === hue }"
                :style="{ background: `hsl(${hue} 55% 42%)` }"
                :title="`色相 ${hue}`"
                :aria-label="`色相 ${hue}`"
                @click="pickTagColor(tag, hue)"
              ></button>
            </div>
            <input
              type="range"
              class="hue-slider"
              min="0"
              max="359"
              :value="hueDrag ?? hueOf(tag)"
              :style="{ '--thumb-c': `hsl(${hueDrag ?? hueOf(tag)} 55% 42%)` }"
              aria-label="自定义色相"
              title="自定义色相"
              @input="dragHue"
              @change="setEditTagHue(tag, $event)"
            />
          </div>
        </template>
        <p v-if="menuTags.length === 0" class="tag-menu-empty">没有匹配的标签</p>
      </div>
      <form class="tag-new" @submit.prevent="addNewTag">
        <input
          v-model="newTagText"
          type="text"
          placeholder="＋ 新建标签，回车添加"
          @keydown.esc.stop="onTagMenuEsc"
        />
        <div class="tag-palette" @mousedown.stop>
          <div class="pal-row">
            <button
              type="button"
              class="pal-swatch pal-auto"
              :class="{ picked: newTagHue === null }"
              :style="{ '--auto-c': tagColor(newTagText.trim() || '新标签') }"
                title="按名字自动配色"
                aria-label="按名字自动配色"
              @click="newTagHue = null"
            ></button>
            <button
              v-for="hue in TAG_PALETTE"
              :key="hue"
              type="button"
              class="pal-swatch"
              :class="{ picked: newTagHue === hue }"
              :style="{ background: `hsl(${hue} 55% 42%)` }"
                :title="`色相 ${hue}`"
                :aria-label="`色相 ${hue}`"
              @click="newTagHue = newTagHue === hue ? null : hue"
            ></button>
          </div>
          <input
            type="range"
            class="hue-slider"
            min="0"
            max="359"
            :value="newTagHue ?? newTagAutoHue"
            :style="{ '--thumb-c': `hsl(${newTagHue ?? newTagAutoHue} 55% 42%)` }"
            aria-label="新建标签的自定义色相"
            title="自定义色相"
            @input="setNewTagHue"
          />
        </div>
      </form>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { SessionGroup, SessionTreeNode } from "../../../shared/session-tree";
import type { SessionSummary } from "../../../shared/types";
import { shortPath } from "../format";
import { panels, persistLayout } from "../layout";
import {
  allTags,
  archiveDirectory,
  archivedDirectoryViews,
  archivedSessionViews,
  archiveSession,
  createSession,
  deleteSession,
  deleteTag,
  favoriteSessions,
  hueOf,
  openSessionTerminal,
  recentAlphaFor,
  refreshSessions,
  renameSession,
  restoreDirectory,
  restoreSession,
  selectSession,
  sessionGroups,
  setSessionTags,
  setTagColor,
  store,
  switchDirectory,
  tagBg,
  tagColor,
  tagColorPicked,
  tagsOf,
  takeSessionMenuRequest,
  togglePin,
} from "../state";

const query = ref("");
/** Per-directory expansion overrides; a directory defaults open when selected. */
const expandedOverride = ref<Record<string, boolean>>({});

// ── tag filter shelf ────────────────────────────────────────────────

/** Selected filter tags; a session must carry ALL of them to stay listed. */
const activeTagFilters = ref<string[]>([]);

function toggleTagFilter(tag: string): void {
  activeTagFilters.value = activeTagFilters.value.includes(tag)
    ? activeTagFilters.value.filter((t) => t !== tag)
    : [...activeTagFilters.value, tag];
}

/** How many shelf chips show before the expandable overflow control. */
const SHELF_PREVIEW = 6;

const shelfExpanded = ref(false);

const shelfShowAll = computed(() => shelfExpanded.value);

/** Active filters stay visible while collapsed, without disabling the expander. */
const shelfTags = computed(() => {
  if (shelfShowAll.value) return allTags.value;
  const active = new Set(activeTagFilters.value);
  return allTags.value.filter((tag, index) => index < SHELF_PREVIEW || active.has(tag));
});

/**
 * Row/favorite chip click: filter to exactly this tag — a second click on the
 * lone active chip clears it. Deliberate single-select, so a stray click never
 * silently stacks AND filters; the shelf is where AND combinations are built.
 */
function filterByTag(tag: string): void {
  activeTagFilters.value =
    activeTagFilters.value.length === 1 && activeTagFilters.value[0] === tag ? [] : [tag];
}

// A filter whose tag died — edited off its last session, or left behind on a
// backend switch — must not keep hiding the list with no chip left to click.
watch(allTags, (live) => {
  const liveSet = new Set(live);
  const kept = activeTagFilters.value.filter((t) => liveSet.has(t));
  if (kept.length !== activeTagFilters.value.length) activeTagFilters.value = kept;
});

/** How many visible sessions carry this tag — the tag menu's count hint. */
function tagCount(tag: string): number {
  return Object.values(store.tags).filter((tags) => tags.includes(tag)).length;
}

/**
 * Row display caps: a row may hold `max` chip ELEMENTS — colored chips plus,
 * when tags overflow, one gray +N (full names in its tooltip). Overflow always
 * reserves one slot, so even a heavily-tagged session keeps one color chip
 * and room for the title.
 */
function rowTags(
  sessionId: string,
  max: number,
): { tags: string[]; more: number; hidden: string[] } {
  const tags = tagsOf(sessionId);
  const cap = tags.length > max ? Math.max(1, max - 1) : max;
  return {
    tags: tags.slice(0, cap),
    more: Math.max(0, tags.length - cap),
    hidden: tags.slice(cap),
  };
}

// ── context menu + inline rename ────────────────────────────────────

const menu = ref<{
  sessionId: string;
  title: string;
  x: number;
  y: number;
  /** Canvas right-click: 重命名 must reveal the sidebar row first. */
  fromCanvas: boolean;
  /** The session's directory — opens its group when revealing the row. */
  directory: string | null;
} | null>(null);
const renaming = ref<{ sessionId: string; title: string } | null>(null);
const renameText = ref("");
const dirMenu = ref<{ directory: string; x: number; y: number } | null>(null);
/** Right-clicked shelf tag awaiting delete confirmation. */
const shelfTagMenu = ref<{ tag: string; x: number; y: number } | null>(null);

function openMenu(session: SessionSummary, x: number, y: number, fromCanvas = false): void {
  dirMenu.value = null;
  shelfTagMenu.value = null;
  menu.value = {
    sessionId: session.id,
    title: session.title,
    x,
    y,
    fromCanvas,
    directory: session.directory,
  };
  placeAndFocusMenu();
}

// Canvas cards right-click into this same menu: they only know the session,
// so look the summary up and hand the click point to openMenu.
watch(
  () => store.sessionMenuRequest,
  (request) => {
    if (!request) return;
    takeSessionMenuRequest();
    const session = store.sessions.find((s) => s.id === request.sessionId);
    if (!session) return;
    openMenu(session, request.x, request.y, true);
  },
);

function closeMenu(): void {
  menu.value = null;
  dirMenu.value = null;
  closeTagMenu();
  shelfTagMenu.value = null;
}

function openDirMenu(directory: string, event: MouseEvent): void {
  menu.value = null;
  shelfTagMenu.value = null;
  dirMenu.value = { directory, x: event.clientX, y: event.clientY };
  placeAndFocusMenu();
}

function openShelfTagMenu(tag: string, event: MouseEvent): void {
  menu.value = null;
  dirMenu.value = null;
  tagMenu.value = null;
  shelfTagMenu.value = { tag, x: event.clientX, y: event.clientY };
  placeAndFocusMenu();
}

/** Same global delete as the tag menu's; the undo toast applies here too. */
function confirmShelfDelete(): void {
  const active = shelfTagMenu.value;
  if (!active) return;
  shelfTagMenu.value = null;
  void deleteTag(active.tag);
}

function beginRename(): void {
  const active = menu.value;
  if (!active) return;
  closeMenu();
  if (active.fromCanvas) revealSessionRow(active.directory);
  renaming.value = { sessionId: active.sessionId, title: active.title };
  renameText.value = active.title;
}

/** A canvas-originated rename edits the sidebar row inline, so that row must
 * be reachable: un-collapse the panel and open the session's directory group. */
function revealSessionRow(directory: string | null): void {
  const panel = panels.sidebar;
  if (panel.collapsed) {
    panel.collapsed = false;
    panel.width = panel.saved;
    persistLayout();
  }
  if (directory && !isDirOpen(directory)) {
    expandedOverride.value = { ...expandedOverride.value, [directory]: true };
  }
}

function cancelRename(): void {
  renaming.value = null;
}

/** 组输入期间的回车在确认候选词，不是提交重命名（见 chat-input 的 onEnterKey）。 */
function onRenameEnter(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  commitRename();
}

/** 组输入期间的 Esc 在关候选词窗，第一次不该顺手关掉重命名。 */
function onRenameEsc(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  cancelRename();
}

function commitRename(): void {
  const active = renaming.value;
  if (!active) return;
  renaming.value = null;
  const title = renameText.value.trim();
  if (!title || title === active.title) return;
  void renameSession(active.sessionId, title);
}

/** Copy the raw session id — for resuming the branch in a terminal. */
function copySessionId(): void {
  const active = menu.value;
  if (!active) return;
  closeMenu();
  void navigator.clipboard.writeText(active.sessionId);
}

/** Open the session in the agent's own TUI (opencode -s / codex resume). */
function openInTerminal(): void {
  const active = menu.value;
  if (!active) return;
  closeMenu();
  void openSessionTerminal(active.sessionId);
}

/** Same soft delete as the canvas 🗑 chip; deleteSession owns the confirm. */
function beginDelete(): void {
  const active = menu.value;
  if (!active) return;
  closeMenu();
  void deleteSession(active.sessionId);
}

// ── tag editor (右键 → 设置标签) ─────────────────────────────────────

const tagMenu = ref<{ sessionId: string; x: number; y: number } | null>(null);
const newTagText = ref("");
/** Draft hue for the tag being created; null = auto (assigned from the name). */
const newTagHue = ref<number | null>(null);
/** The tag whose color palette row is open; null = none. */
const colorEdit = ref<string | null>(null);
const tagSearch = ref("");
/**
 * Snapshot of the session's tags taken when the menu opened. Checkboxes read
 * and save through this draft, so rapid toggles never race a pending write
 * (a stale store read could otherwise re-add a just-deleted tag).
 */
const draftTags = ref<string[]>([]);

/** Preset hues — one tidy row, curated to look right at the chip's s/l. */
const TAG_PALETTE = [355, 25, 45, 145, 175, 210, 260, 315] as const;

/** Below this many tags the search row stays hidden — nothing to sift. */
const TAG_SEARCH_MIN = 8;

const menuTags = computed(() => {
  const needle = tagSearch.value.trim().toLowerCase();
  if (!needle) return allTags.value;
  return allTags.value.filter((t) => t.toLowerCase().includes(needle));
});

/** Hue the auto cell would give the tag being typed, before it exists. */
const newTagAutoHue = computed(() => hueOf(newTagText.value.trim() || "新标签"));

/** Live hue while dragging the edit slider; lands on release. */
const hueDrag = ref<number | null>(null);

function dragHue(event: Event): void {
  hueDrag.value = Number((event.target as HTMLInputElement).value);
}

function toggleColorEdit(tag: string): void {
  hueDrag.value = null;
  colorEdit.value = colorEdit.value === tag ? null : tag;
}

/** Anchor near the context menu that opened it; stays until click-out/Esc. */
function openTagMenu(): void {
  const active = menu.value;
  if (!active) return;
  tagMenu.value = { sessionId: active.sessionId, x: active.x, y: active.y + 36 };
  draftTags.value = [...tagsOf(active.sessionId)];
  newTagText.value = "";
  newTagHue.value = null;
  tagSearch.value = "";
  colorEdit.value = null;
  hueDrag.value = null;
  delConfirm.value = null;
  menu.value = null;
  placeAndFocusMenu();
}

function menuElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".ctx-menu");
}

function placeAndFocusMenu(): void {
  void nextTick(() => {
    const active = menu.value ?? dirMenu.value ?? shelfTagMenu.value ?? tagMenu.value;
    const element = menuElement();
    if (!active || !element) return;
    active.x = Math.max(8, Math.min(active.x, window.innerWidth - element.offsetWidth - 8));
    active.y = Math.max(8, Math.min(active.y, window.innerHeight - element.offsetHeight - 8));
    element.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled])")?.focus();
  });
}

function trapMenuTab(event: KeyboardEvent): void {
  const menuElement = event.currentTarget as HTMLElement;
  const items = [
    ...menuElement.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])"),
  ];
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (event.shiftKey && index <= 0) {
    event.preventDefault();
    items.at(-1)?.focus();
  } else if (!event.shiftKey && index === items.length - 1) {
    event.preventDefault();
    items[0]?.focus();
  }
}

function closeTagMenu(): void {
  tagMenu.value = null;
  newTagText.value = "";
  newTagHue.value = null;
  colorEdit.value = null;
  hueDrag.value = null;
  delConfirm.value = null;
  tagSearch.value = "";
  draftTags.value = [];
}

/** Esc closes the menu, except while an IME is dismissing its candidate list. */
function onTagMenuEsc(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  closeTagMenu();
}

function pickTagColor(tag: string, hue: number | null): void {
  hueDrag.value = null;
  void setTagColor(tag, hue);
}

function setEditTagHue(tag: string, event: Event): void {
  hueDrag.value = null;
  void setTagColor(tag, Number((event.target as HTMLInputElement).value));
}

function setNewTagHue(event: Event): void {
  newTagHue.value = Number((event.target as HTMLInputElement).value);
}

/** The tag whose inline delete-confirm strip is open; null = none. */
const delConfirm = ref<string | null>(null);

/** Remove the tag from this session only — same write as unchecking. */
function confirmDelLocal(tag: string): void {
  const active = tagMenu.value;
  delConfirm.value = null;
  if (!active) return;
  draftTags.value = draftTags.value.filter((t) => t !== tag);
  void setSessionTags(active.sessionId, draftTags.value);
}

/**
 * Delete the tag everywhere; a filter sitting on it clears via the watcher.
 * The toast in state offers 撤销 for a few seconds after.
 */
function confirmDelAll(tag: string): void {
  delConfirm.value = null;
  colorEdit.value = null;
  // Gone from the draft too, or a queued checkbox write could resurrect it.
  draftTags.value = draftTags.value.filter((t) => t !== tag);
  void deleteTag(tag);
}

function toggleDraftTag(tag: string): void {
  const active = tagMenu.value;
  if (!active) return;
  draftTags.value = draftTags.value.includes(tag)
    ? draftTags.value.filter((t) => t !== tag)
    : [...draftTags.value, tag];
  void setSessionTags(active.sessionId, draftTags.value);
}

async function addNewTag(): Promise<void> {
  const active = tagMenu.value;
  const tag = newTagText.value.trim();
  if (!active || !tag) return;
  let attached = draftTags.value.includes(tag);
  if (!draftTags.value.includes(tag)) {
    draftTags.value = [...draftTags.value, tag];
    attached = await setSessionTags(active.sessionId, draftTags.value);
  }
  if (attached && newTagHue.value !== null) void setTagColor(tag, newTagHue.value);
  newTagText.value = "";
  newTagHue.value = null;
}

/** Archive is fully reversible — no confirm, the archive section undoes it. */
function beginArchive(): void {
  const active = menu.value;
  if (!active) return;
  closeMenu();
  void archiveSession(active.sessionId);
}

/** Whole-directory archive is just as reversible from the archive section. */
function beginDirArchive(): void {
  const active = dirMenu.value;
  if (!active) return;
  closeMenu();
  void archiveDirectory(active.directory);
}

// ── favorites shelf + archive section ───────────────────────────────

/** Stars across every directory — a jump list, so it starts expanded. */
const favOpen = ref(true);

function openFavorite(session: SessionSummary): void {
  // selectSession switches directory itself when the star lives elsewhere.
  void selectSession(session.id, { focus: true });
}

const archiveOpen = ref(false);

const archiveCount = computed(
  () => archivedDirectoryViews.value.length + archivedSessionViews.value.length,
);

function onRestoreDirectory(directory: string): void {
  void restoreDirectory(directory);
}

function onRestoreSession(sessionId: string): void {
  void restoreSession(sessionId);
}

/** Function ref: focus (and select) the rename input the moment it mounts. */
function focusRenameInput(el: unknown): void {
  const input = el as HTMLInputElement | null;
  if (input) {
    input.focus();
    input.select();
  }
}

function onDocMousedown(): void {
  closeMenu();
}

function onDocKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
  if (!menu.value && !dirMenu.value && !tagMenu.value && !shelfTagMenu.value) return;
  event.preventDefault();
  closeMenu();
}

onMounted(() => {
  document.addEventListener("mousedown", onDocMousedown);
  document.addEventListener("keydown", onDocKeydown);
});
onUnmounted(() => {
  document.removeEventListener("mousedown", onDocMousedown);
  document.removeEventListener("keydown", onDocKeydown);
});

const selectedDirectory = computed(() => store.selectedDirectory);
const selectedId = computed(() => store.selectedId);

const searching = computed(() => query.value.trim().length > 0);

function isDirOpen(directory: string): boolean {
  if (searching.value) return true;
  const override = expandedOverride.value[directory];
  return override ?? directory === selectedDirectory.value;
}

function isOpen(group: SessionGroup): boolean {
  return isDirOpen(group.directory);
}

function toggleDir(directory: string): void {
  expandedOverride.value = { ...expandedOverride.value, [directory]: !isDirOpen(directory) };
}

function pinToggle(sessionId: string): void {
  void togglePin(sessionId);
}

/** One-click row archive — reversible from the archive section, so no confirm. */
function rowArchive(sessionId: string): void {
  void archiveSession(sessionId);
}

const visibleGroups = computed<SessionGroup[]>(() => {
  const needle = query.value.trim().toLowerCase();
  const filters = activeTagFilters.value;
  return sessionGroups.value
    .map((group) => {
      if (!needle && filters.length === 0) return group;
      const keep = (node: SessionTreeNode): SessionTreeNode | null => {
        const children = node.children.map(keep).filter((n): n is SessionTreeNode => n !== null);
        const tags = tagsOf(node.session.id);
        const textHit =
          !needle ||
          node.session.title.toLowerCase().includes(needle) ||
          tags.some((t) => t.toLowerCase().includes(needle));
        const filterHit = filters.every((f) => tags.includes(f));
        return textHit && filterHit
          ? { ...node, children }
          : children.length > 0
            ? { ...node, children }
            : null;
      };
      const roots = group.roots.map(keep).filter((n): n is SessionTreeNode => n !== null);
      return { directory: group.directory, roots };
    })
    .filter((group) => group.roots.length > 0);
});

interface SessionRow {
  session: SessionTreeNode["session"];
  depth: number;
}

function flatSessions(group: SessionGroup): SessionRow[] {
  const rows: SessionRow[] = [];
  const walk = (nodes: SessionTreeNode[], depth: number): void => {
    for (const node of nodes) {
      rows.push({ session: node.session, depth });
      walk(node.children, depth + 1);
    }
  };
  walk(group.roots, 0);
  return rows;
}

function countSessions(group: SessionGroup): number {
  return flatSessions(group).length;
}

function selectDirectory(directory: string): void {
  expandedOverride.value = { ...expandedOverride.value, [directory]: true };
  void switchDirectory(directory);
}

function emitRefresh(): void {
  void refreshSessions();
}
function emitCreate(): void {
  void createSession();
}
</script>
