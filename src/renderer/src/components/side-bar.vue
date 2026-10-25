<template>
  <aside class="sidebar">
    <nav class="side-tabs" :aria-label="t('files.sidebarViewLabel')">
      <button
        type="button"
        class="side-tab"
        :class="{ on: sidebarView === 'sessions' }"
        :aria-pressed="sidebarView === 'sessions'"
        @click="setSidebarView('sessions')"
        >{{ t("files.tabSessions") }}</button
      >
      <button
        v-if="fileBrowserEnabled"
        type="button"
        class="side-tab"
        :class="{ on: sidebarView === 'files' }"
        :aria-pressed="sidebarView === 'files'"
        @click="setSidebarView('files')"
        >{{ t("files.tabFiles") }}</button
      >
    </nav>
    <div v-show="sidebarView === 'sessions'" class="sidebar-sessions">
    <div class="search-row">
      <div class="search">
        <span>⌕</span>
        <input
          ref="searchInputEl"
          v-model="query"
          type="text"
          :placeholder="searchPlaceholder"
          :aria-label="t('sidebar.searchSessions')"
        />
        <button
          v-if="query.length > 0"
          type="button"
          class="search-clear"
          :title="t('sidebar.clearSearch')"
          :aria-label="t('sidebar.clearSearch')"
          @click="clearQuery"
        >✕</button>
        <button
          type="button"
          class="search-boost"
          :class="{ on: boostActive }"
          :title="boostOpen ? t('sidebar.collapseBoost') : t('sidebar.boostTitle')"
          :aria-expanded="boostOpen"
          @mousedown.stop
          @click.stop="boostOpen = !boostOpen"
        >✦</button>
      </div>
      <button
        type="button"
        class="search-refresh"
        :class="{ refreshing }"
        :disabled="refreshing"
        :title="t('sidebar.refreshList')"
        :aria-label="t('sidebar.refreshList')"
        @click="emitRefresh"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 11a8 8 0 0 0-14.9-4L3 10m0-6v6h6M4 13a8 8 0 0 0 14.9 4l2.1-3m0 6v-6h-6" />
        </svg>
      </button>
    </div>
    <div v-if="boostOpen" class="boost-menu" @mousedown.stop>
      <div class="boost-head">{{ t("sidebar.searchScopes") }}</div>
      <div class="boost-scopes">
        <label class="boost-opt"
          ><input v-model="searchScopes.title" type="checkbox" />{{ t("sidebar.scopeTitleCap") }}</label
        >
        <label class="boost-opt"
          ><input v-model="searchScopes.tag" type="checkbox" />{{ t("sidebar.scopeTagCap") }}</label
        >
        <label class="boost-opt"
          ><input v-model="searchScopes.body" type="checkbox" />{{ t("sidebar.scopeBodyFull") }}</label
        >
      </div>
      <div class="boost-head">{{ t("sidebar.project") }}</div>
      <div class="boost-project">
        <select v-model="projectScope" :aria-label="t('sidebar.limitToProject')">
          <option value="">{{ t("sidebar.allProjects") }}</option>
          <option v-for="dir in projectOptions" :key="dir" :value="dir">
            {{ shortPath(dir) }}
          </option>
        </select>
      </div>
      <div class="boost-head">{{ t("sidebar.searchLimit") }}</div>
      <div class="boost-scopes">
        <label class="boost-opt"><input v-model="searchLimit" type="radio" value="100" /> 100</label>
        <label class="boost-opt"><input v-model="searchLimit" type="radio" value="300" /> 300</label>
        <label class="boost-opt"><input v-model="searchLimit" type="radio" value="1000" /> 1000</label>
        <label class="boost-opt"
          ><input v-model="searchLimit" type="radio" value="all" /> {{ t("sidebar.all") }}</label
        >
      </div>
      <div class="boost-head">{{ t("sidebar.syntax") }}</div>
      <dl class="boost-syntax">
        <dt><code>body:word</code></dt>
        <dd>{{ t("sidebar.synBody") }}</dd>
        <dt><code>#tag</code></dt>
        <dd>{{ t("sidebar.synTag") }}</dd>
        <dt><code>title:word</code></dt>
        <dd>{{ t("sidebar.synTitle") }}</dd>
        <dt><code>dir:path</code></dt>
        <dd>{{ t("sidebar.synDir") }}</dd>
        <dt><code>"exact phrase"</code></dt>
        <dd>{{ t("sidebar.synPhrase") }}</dd>
        <dt><code>-word</code></dt>
        <dd>{{ t("sidebar.synExclude") }}</dd>
      </dl>
      <p class="boost-note">{{ t("sidebar.bodyNote") }}</p>
      <button
        v-if="boostOffDefault"
        type="button"
        class="boost-reset"
        :title="t('sidebar.resetTitle')"
        @click="resetBoost"
        >{{ t("sidebar.resetSearch") }}</button
      >
    </div>
    <p v-if="bodyScanning" class="body-scan">{{ t("sidebar.bodyScanning") }}</p>
    <div v-if="allTags.length > 0" class="tag-shelf-zone">
      <div id="tag-shelf" class="tag-shelf">
        <button
          v-for="tag in shelfTags"
          :key="tag"
          type="button"
          class="tag-filter"
          :class="{ on: activeTagFilters.includes(tag) }"
          :style="{ '--tag-c': tagColor(tag) }"
          :title="
            activeTagFilters.includes(tag)
              ? t('sidebar.clearTagFilter')
              : t('sidebar.filterByTag')
          "
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
        >{{
          shelfShowAll ? t("sidebar.collapseTags") : t("sidebar.moreTags", { n: allTags.length - SHELF_PREVIEW })
        }}
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
        <span>{{ t("sidebar.pinned") }}</span>
        <span class="proj-count">{{ favoriteSessions.length }}</span>
      </button>
      <div v-if="favOpen" id="favorite-list" class="fav-list">
        <div
          v-for="sess in favoriteSessions"
          :key="sess.id"
          class="fav-row"
          :class="{ active: sess.id === selectedId, running: store.running[sess.id] }"
        >
          <button
            type="button"
            class="fav-session"
            :title="`${sess.title || '(untitled)'} · ${shortPath(sess.directory)}`"
            @click="openFavorite(sess)"
          >
            <span class="fav-dot"></span>
            <span v-if="sess.origin === 'fork'" class="fork-glyph">⎇</span>
            <span v-if="isEmptyContext(sess.id)" class="cut-glyph" :title="t('cut.markerTitle')"
              >✂</span
            >
            <span class="fav-name">{{ sess.title || "(untitled)" }}</span>
            <span
              v-for="tag in rowTags(sess.id, 1).tags"
              :key="tag"
              class="tag-chip clickable"
              :style="{ color: tagColor(tag), background: tagBg(tag) }"
              :title="t('sidebar.filterByTag')"
              @click.stop="filterByTag(tag)"
              >{{ tag }}</span
            >
            <span
              v-if="rowTags(sess.id, 1).more > 0"
              class="tag-chip tag-more"
              :title="rowTags(sess.id, 1).hidden.join(listSep)"
            >+{{ rowTags(sess.id, 1).more }}</span>
            <span class="fav-time">{{ relTime(sess.updatedAt) }}</span>
          </button>
          <button
            type="button"
            class="fav-unpin"
            :title="t('sidebar.unpin')"
            :aria-label="t('sidebar.unpin')"
            @click="unpinFavorite(sess.id)"
          >×</button>
        </div>
      </div>
    </div>
    <div class="proj-head">
      <button
        type="button"
        class="head-caret"
        :title="projectsOpen ? t('sidebar.collapseProjects') : t('sidebar.expandProjects')"
        :aria-expanded="projectsOpen"
        @click="projectsOpen = !projectsOpen"
        >{{ projectsOpen ? "▾" : "▸" }}</button>
      <button type="button" class="head-label" @click="projectsOpen = !projectsOpen">{{
        t("sidebar.projects")
      }}</button>
      <span class="head-actions">
        <button
          type="button"
          class="head-icon"
          :title="t('sidebar.setResidentTitle')"
          @click="emitChooseResident"
        >＋</button>
      </span>
    </div>
    <nav v-show="projectsOpen" class="session-list">
      <template v-for="group in visibleGroups" :key="group.directory">
        <div
          class="proj-row"
          :class="{ active: group.directory === selectedDirectory }"
          @contextmenu.prevent="openDirMenu(group.directory, $event)"
        >
          <button
            type="button"
            class="proj-caret"
            :title="isOpen(group) ? t('sidebar.collapseDir') : t('sidebar.expandDir')"
            @click="toggleDir(group.directory)"
          >{{ isOpen(group) ? "▾" : "▸" }}</button>
          <button
            type="button"
            class="proj"
            :class="{ active: group.directory === selectedDirectory }"
            :title="group.directory"
            @click="selectDirectory(group.directory)"
          >
            <span v-if="isResident(group.directory)" class="resident-pin" :title="t('sidebar.residentPin')">📌</span>
            <span>📁</span>
            <span class="proj-name">{{ shortPath(group.directory) }}</span>
            <span v-if="countSessions(group) > 0" class="proj-count">{{ countSessions(group) }}</span>
          </button>
          <button
            type="button"
            class="proj-add"
            :title="t('sidebar.newChatHere')"
            @click="emitCreateIn(group.directory)"
          >＋</button>
        </div>
        <template v-if="isOpen(group)">
          <template v-for="row in visibleRows(group)" :key="row.session.id">
            <div class="sess-row" :class="{ active: row.session.id === selectedId }">
              <button
                v-if="row.childCount > 0"
                type="button"
                class="sess-caret"
                :disabled="queryActive"
                :title="
                  isBranchCollapsed(row.session.id)
                    ? t('sidebar.expandBranch', { n: row.descendantCount })
                    : t('sidebar.collapseBranch')
                "
                :aria-expanded="!isBranchCollapsed(row.session.id)"
                @click.stop="toggleBranch(row.session.id)"
              >{{ isBranchCollapsed(row.session.id) ? "▸" : "▾" }}</button>
              <span v-else class="sess-caret ghost" aria-hidden="true"></span>
              <input
                v-if="renaming?.sessionId === row.session.id"
                :ref="focusRenameInput"
                v-model="renameText"
                class="sess-rename"
                :style="{ marginLeft: `${22 + row.depth * 14}px` }"
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
                @click="onRowClick(row.session.id)"
                @auxclick="onRowAuxClick(row.session.id, $event)"
                @contextmenu.prevent="openMenu(row.session, $event.clientX, $event.clientY)"
              >
                <span class="dot"></span>
                <span v-if="row.session.origin === 'fork'" class="fork-glyph">⎇</span>
                <span
                  v-if="isEmptyContext(row.session.id)"
                  class="cut-glyph"
                  :title="t('cut.markerTitle')"
                  >✂</span
                >
                <span class="sess-name">
                  <template
                    v-for="(segment, index) in titleSegments(row.session.title)"
                    :key="index"
                  >
                    <mark v-if="segment.hit" class="hl">{{ segment.text }}</mark>
                    <template v-else>{{ segment.text }}</template>
                  </template>
                </span>
                <span
                  v-for="tag in rowTags(row.session.id, 2).tags"
                  :key="tag"
                  class="tag-chip clickable"
                  :style="{ color: tagColor(tag), background: tagBg(tag) }"
                  :title="t('sidebar.filterByTag')"
                  @click.stop="filterByTag(tag)"
                  >{{ tag }}</span
                >
                <span
                  v-if="rowTags(row.session.id, 2).more > 0"
                  class="tag-chip tag-more"
                  :title="rowTags(row.session.id, 2).hidden.join(listSep)"
                >+{{ rowTags(row.session.id, 2).more }}</span>
              </button>
              <button
                v-if="pendingAction?.sessionId === row.session.id && pendingAction.kind === 'pin'"
                type="button"
                class="sess-confirm"
                :title="
                  store.pins.includes(row.session.id)
                    ? t('sidebar.confirmUnpin')
                    : t('sidebar.confirmPin')
                "
                @mousedown.stop
                @click.stop="confirmRowAction(row.session.id, 'pin')"
                >{{ t("sidebar.confirm") }}</button
              >
              <button
                v-else
                type="button"
                class="pin-star"
                :class="{ on: store.pins.includes(row.session.id) }"
                :title="store.pins.includes(row.session.id) ? t('sidebar.unpin') : t('sidebar.pin')"
                @mousedown.stop
                @click.stop="armRowAction(row.session.id, 'pin')"
              >{{ store.pins.includes(row.session.id) ? "★" : "☆" }}</button>
              <button
                v-if="pendingAction?.sessionId === row.session.id && pendingAction.kind === 'archive'"
                type="button"
                class="sess-confirm"
                :title="t('sidebar.confirmArchive')"
                @mousedown.stop
                @click.stop="confirmRowAction(row.session.id, 'archive')"
                >{{ t("sidebar.confirm") }}</button
              >
              <button
                v-else
                type="button"
                class="sess-archive"
                :title="t('sidebar.archiveTitle')"
                @mousedown.stop
                @click.stop="armRowAction(row.session.id, 'archive')"
              >📦</button>
            </div>
            <div v-if="bodyHits.has(row.session.id)" class="sess-snips">
              <button
                v-for="hit in bodyHits.get(row.session.id) ?? []"
                :key="hit.messageId"
                type="button"
                class="sess-snip"
                :style="{ paddingLeft: `${22 + row.depth * 14 + 10}px` }"
                :title="t('sidebar.locateMessage')"
                @click="jumpToHit(hit)"
              >
                <template v-for="(segment, index) in snippetSegments(hit)" :key="index">
                  <mark v-if="segment.hit" class="hl">{{ segment.text }}</mark>
                  <template v-else>{{ segment.text }}</template>
                </template>
              </button>
            </div>
          </template>
        </template>
      </template>
      <p v-if="visibleGroups.length === 0 && !bodyScanning" class="group-empty">{{
        t("sidebar.noMatches")
      }}</p>
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
        <span>{{ t("sidebar.archive") }}</span>
        <span v-if="archiveCount > 0" class="proj-count">{{ archiveCount }}</span>
      </button>
      <div v-if="archiveOpen" id="archive-list" class="archive-list">
        <div v-for="dir in archivedDirectoryViews" :key="`dir:${dir.path}`" class="arch-row">
          <span class="arch-name" :title="dir.path">📁 {{ shortPath(dir.path) }}</span>
          <span class="arch-count" :title="t('sidebar.hiddenSessions', { n: dir.hiddenCount })">{{
            dir.hiddenCount
          }}</span>
          <button
            type="button"
            class="arch-restore"
            :title="t('sidebar.restoreDir')"
            @click="onRestoreDirectory(dir.path)"
            >↩</button
          >
        </div>
        <div v-for="sess in archivedSessionViews" :key="`sess:${sess.id}`" class="arch-row">
          <span class="arch-name" :title="sess.title">{{ sess.title }}</span>
          <button
            type="button"
            class="arch-restore"
            :title="t('sidebar.restoreSession')"
            @click="onRestoreSession(sess.id)"
            >↩</button
          >
        </div>
        <p v-if="archiveCount === 0" class="group-empty">{{ t("sidebar.archiveEmpty") }}</p>
      </div>
    </div>

    <SessionFileDock />

    <div
      v-if="menu"
      class="ctx-menu"
      role="menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @mousedown.stop
      @keydown.tab="trapMenuTab"
    >
      <!-- pinning stays in the sidebar row menu only; canvas right-click does not
           offer it -->
      <button
        v-if="!menu.fromCanvas"
        type="button"
        role="menuitem"
        class="ctx-menu-item"
        @click="togglePinFromMenu"
      >
        {{ menuPinned ? t("sidebar.menuUnpin") : t("sidebar.menuPin") }}
      </button>
      <button
        v-if="menu.turnId"
        type="button"
        role="menuitem"
        class="ctx-menu-item"
        @click="toggleMarkFromMenu"
      >
        {{ menuMarked ? t("sidebar.menuUnmark") : t("sidebar.menuMark") }}
      </button>
      <button type="button" role="menuitem" class="ctx-menu-item" @click="beginRename">{{
        t("sidebar.rename")
      }}</button>
      <button type="button" role="menuitem" class="ctx-menu-item" @click="openInNewTabFromMenu">{{
        t("sidebar.openInNewTab")
      }}</button>
      <button type="button" role="menuitem" class="ctx-menu-item" @click="openTagMenu">{{
        t("sidebar.setTags")
      }}</button>
      <button
        v-if="menuInDirectory"
        type="button"
        role="menuitem"
        class="ctx-menu-item"
        :title="t('sidebar.compareTitle')"
        @click="compareFromMenu"
        >{{ t("sidebar.compare") }}</button
      >
      <button type="button" role="menuitem" class="ctx-menu-item" @click="copySessionId">{{
        t("sidebar.copyId")
      }}</button>
      <button type="button" role="menuitem" class="ctx-menu-item" @click="openInTerminal">{{
        t("sidebar.openTerminal")
      }}</button>
      <button
        v-if="store.capabilities.compress"
        type="button"
        role="menuitem"
        class="ctx-menu-item"
        :title="menuTurn ? t('sidebar.compressTitleTurn') : t('sidebar.compressTitle')"
        @click="compressFromMenu"
        >{{ t("sidebar.compress") }}</button
      >
      <button
        v-if="store.capabilities.exportBranch"
        type="button"
        role="menuitem"
        class="ctx-menu-item"
        :title="menuTurn ? t('sidebar.exportTitleTurn') : t('sidebar.exportTitle')"
        @click="exportFromMenu"
        >{{ t("sidebar.export") }}</button
      >
      <button type="button" role="menuitem" class="ctx-menu-item" @click="beginArchive">{{
        t("sidebar.archiveSession")
      }}</button>
      <button
        v-if="store.capabilities.deleteSession"
        type="button"
        role="menuitem"
        class="ctx-menu-item danger"
        @click="beginDelete"
      >
        {{ t("sidebar.deleteSession") }}
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
      <button type="button" role="menuitem" class="ctx-menu-item" @click="beginDirCreate">
        {{ t("sidebar.dirNewChat") }}
      </button>
      <button
        v-if="isResident(dirMenu.directory)"
        type="button"
        role="menuitem"
        class="ctx-menu-item"
        @click="beginDirClearResident"
      >
        {{ t("sidebar.dirClearResident") }}
      </button>
      <template v-else>
        <button
          type="button"
          role="menuitem"
          class="ctx-menu-item"
          @click="beginDirSetResident"
        >
          {{ t("sidebar.dirSetResident") }}
        </button>
        <button
          v-if="dirSessionCount(dirMenu.directory) > 0"
          type="button"
          role="menuitem"
          class="ctx-menu-item"
          @click="beginDirArchive"
        >
          {{ t("sidebar.dirArchive") }}
        </button>
      </template>
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
          >{{ t("sidebar.tagOnSessions", { tag: shelfTagMenu.tag, n: tagCount(shelfTagMenu.tag) }) }}</span
        >
        <div class="tdc-btns">
          <button
            type="button"
            class="tdc-btn danger"
            :title="t('sidebar.deleteTagFromAll')"
            @click="confirmShelfDelete"
            >{{ t("sidebar.deleteAll") }}</button
          >
          <button type="button" class="tdc-btn" @click="shelfTagMenu = null">{{
            t("sidebar.cancel")
          }}</button>
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
      <div class="tag-menu-head">{{ t("sidebar.sessionTags") }}</div>
      <div v-if="allTags.length > TAG_SEARCH_MIN" class="tag-menu-search">
        <span>⌕</span>
        <input
          v-model="tagSearch"
          type="text"
          :placeholder="t('sidebar.searchTags')"
          :aria-label="t('sidebar.searchTags')"
          @keydown.esc.stop="onTagMenuEsc"
        />
      </div>
      <div class="tag-menu-list" role="group" :aria-label="t('sidebar.tagList')">
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
              :title="
                tagColorPicked(tag) ? t('sidebar.changeColor') : t('sidebar.pickColor')
              "
              :aria-label="
                tagColorPicked(tag)
                  ? t('sidebar.editTagColor', { tag })
                  : t('sidebar.chooseTagColor', { tag })
              "
              @click.stop.prevent="toggleColorEdit(tag)"
            ></button>
            <button
              type="button"
              class="tag-del"
              :class="{ arming: delConfirm === tag }"
              :title="t('sidebar.deleteTagTitle')"
              @click.stop.prevent="delConfirm = delConfirm === tag ? null : tag"
            >🗑</button>
          </label>
          <div v-if="delConfirm === tag" class="tag-del-confirm" @mousedown.stop>
            <span class="tdc-text"
              >{{ t("sidebar.tagOnSessions", { tag, n: tagCount(tag) }) }}</span
            >
            <div class="tdc-btns">
              <button
                v-if="draftTags.includes(tag)"
                type="button"
                class="tdc-btn"
                :title="t('sidebar.removeLocalTitle')"
                @click="confirmDelLocal(tag)"
                >{{ t("sidebar.removeLocal") }}</button
              >
              <button
                type="button"
                class="tdc-btn danger"
                :title="t('sidebar.deleteTagFromAll')"
                @click="confirmDelAll(tag)"
                >{{ t("sidebar.deleteAll") }}</button
              >
              <button type="button" class="tdc-btn" @click="delConfirm = null">{{
                t("sidebar.cancel")
              }}</button>
            </div>
          </div>
          <div v-if="colorEdit === tag" class="tag-palette" @mousedown.stop>
            <div class="pal-row">
              <button
                type="button"
                class="pal-swatch pal-auto"
                :class="{ picked: !tagColorPicked(tag) }"
                :style="{ '--auto-c': tagColor(tag) }"
                :title="t('sidebar.autoColor')"
                :aria-label="t('sidebar.autoColor')"
                @click="pickTagColor(tag, null)"
              ></button>
              <button
                v-for="hue in TAG_PALETTE"
                :key="hue"
                type="button"
                class="pal-swatch"
                :class="{ picked: tagColorPicked(tag) && hueOf(tag) === hue }"
                :style="{ background: `hsl(${hue} 55% 42%)` }"
                :title="t('sidebar.hue', { hue })"
                :aria-label="t('sidebar.hue', { hue })"
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
              :aria-label="t('sidebar.customHue')"
              :title="t('sidebar.customHue')"
              @input="dragHue"
              @change="setEditTagHue(tag, $event)"
            />
          </div>
        </template>
        <p v-if="menuTags.length === 0" class="tag-menu-empty">{{ t("sidebar.noTagMatches") }}</p>
      </div>
      <form class="tag-new" @submit.prevent="addNewTag">
        <input
          v-model="newTagText"
          type="text"
          :placeholder="t('sidebar.newTagPlaceholder')"
          @keydown.esc.stop="onTagMenuEsc"
        />
        <div class="tag-palette" @mousedown.stop>
          <div class="pal-row">
            <button
              type="button"
              class="pal-swatch pal-auto"
              :class="{ picked: newTagHue === null }"
              :style="{ '--auto-c': tagColor(newTagText.trim() || 'new tag') }"
              :title="t('sidebar.autoColor')"
              :aria-label="t('sidebar.autoColor')"
              @click="newTagHue = null"
            ></button>
            <button
              v-for="hue in TAG_PALETTE"
              :key="hue"
              type="button"
              class="pal-swatch"
              :class="{ picked: newTagHue === hue }"
              :style="{ background: `hsl(${hue} 55% 42%)` }"
              :title="t('sidebar.hue', { hue })"
              :aria-label="t('sidebar.hue', { hue })"
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
            :aria-label="t('sidebar.newTagHue')"
            :title="t('sidebar.customHue')"
            @input="setNewTagHue"
          />
        </div>
      </form>
      <div v-if="subtreeAsk" class="tag-menu-subtree" @mousedown.stop>
        <span class="subtree-text"
          >{{
            t("sidebar.subtreeAsk", { tags: subtreeAsk.tags.join(listSep), n: subtreeAsk.count })
          }}</span
        >
        <div class="subtree-btns">
          <button
            type="button"
            class="subtree-btn apply"
            :title="t('sidebar.subtreeApplyTitle')"
            @click="answerSubtreeApply"
            >{{ t("sidebar.apply") }}</button
          >
          <button
            type="button"
            class="subtree-btn"
            :title="t('sidebar.subtreeSkipTitle')"
            @click="answerSubtreeSkip"
            >{{ t("sidebar.thisSession") }}</button
          >
        </div>
      </div>
      <div v-if="draftTags.length > 0" class="tag-menu-pref" @mousedown.stop>
        <span class="pref-label">{{ t("sidebar.forkPrefLabel") }}</span>
        <div class="pref-options" role="radiogroup" :aria-label="t('sidebar.forkPrefLabel')">
          <button
            type="button"
            :class="{ active: forkPref === null }"
            :title="t('sidebar.prefAskTitle')"
            @click="setPref(null)"
            >{{ t("sidebar.prefAsk") }}</button
          >
          <button
            type="button"
            :class="{ active: forkPref === true }"
            :title="t('sidebar.prefAlwaysTitle')"
            @click="setPref(true)"
            >{{ t("sidebar.prefAlways") }}</button
          >
          <button
            type="button"
            :class="{ active: forkPref === false }"
            :title="t('sidebar.prefNeverTitle')"
            @click="setPref(false)"
            >{{ t("sidebar.prefNever") }}</button
          >
        </div>
      </div>
    </div>
    </div>
    <FileTree v-show="sidebarView === 'files'" class="sidebar-files" />
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import type { BodySearchHit } from "../../../shared/awefork-api";
import {
  bodySearchTerms,
  firstMatchRange,
  gatesOk,
  localTextMatched,
  parseSearchQuery,
  type ScopeSet,
} from "../../../shared/search-query";
import {
  type FlatSessionRow,
  flattenSessionTree,
  type SessionGroup,
  type SessionTreeNode,
} from "../../../shared/session-tree";
import type { SessionSummary } from "../../../shared/types";
import { relTime, shortPath } from "../format";
import { listSep, t } from "../i18n";
import { fileBrowserEnabled, panels, persistLayout, setSidebarView, sidebarView } from "../layout";
import { settings } from "../settings";
import {
  allTags,
  applyTagsToSubtree,
  archiveDirectory,
  archivedDirectoryViews,
  archivedSessionViews,
  archiveSession,
  beginComparePick,
  cancelComparePick,
  chooseResidentFolder,
  clearResidentFolder,
  compressSession,
  createSession,
  deleteSession,
  deleteTag,
  directorySessions,
  enterCompare,
  exportSessionAt,
  favoriteSessions,
  forkTagPrefOf,
  hueOf,
  isEmptyContext,
  isResidentFolder,
  isTurnMarked,
  jumpToMessage,
  openCanvasTab,
  openSession,
  openSessionTerminal,
  recentAlphaFor,
  refreshSessions,
  renameSession,
  restoreDirectory,
  restoreSession,
  sessionGroups,
  setForkTagPref,
  setResidentFolder,
  setSessionTags,
  setTagColor,
  store,
  subtreeSessionIds,
  switchDirectory,
  tagBg,
  tagColor,
  tagColorPicked,
  tagsOf,
  takeSessionMenuRequest,
  togglePin,
  toggleTurnMark,
  turnGraph,
  visibleSessions,
} from "../state";
import FileTree from "./file-tree.vue";
import SessionFileDock from "./session-file-dock.vue";

const query = ref("");
const searchInputEl = ref<HTMLInputElement | null>(null);
const refreshing = ref(false);
/** Sidebar row action awaiting its second, explicit click. */
const pendingAction = ref<{ sessionId: string; kind: "pin" | "archive" } | null>(null);
/** Per-directory expansion overrides; a directory defaults open when selected. */
const expandedOverride = ref<Record<string, boolean>>({});

/** ✕ in the input row: wipe the text, keep typing from a clean slate. */
function clearQuery(): void {
  query.value = "";
  searchInputEl.value?.focus();
}

// ── enhanced search (✦) ─────────────────────────────────────────────

/** Which surfaces plain terms search; body is opt-in (a scan costs a round-trip per session). */
const searchScopes = reactive<ScopeSet>({ ...settings.search.scopes });
const boostOpen = ref(false);

/** Pin a search to one project directory. Empty = search every project (default). */
const projectScope = ref<string>("");
/** Options: every directory the sidebar knows about, in session-recency order. */
const projectOptions = computed(() => sessionGroups.value.map((group) => group.directory));
/** How many sessions to scan for body hits; "all" means no cap. */
const searchLimit = ref<string>(settings.search.cap > 0 ? String(settings.search.cap) : "all");

// The ✦ panel's per-search knobs double as the next search's defaults, so a
// choice made in the panel and the same row in settings never disagree.
watch(searchScopes, () => {
  settings.search.scopes = { ...searchScopes };
});
watch(searchLimit, (value) => {
  settings.search.cap = value === "all" ? 0 : Number(value);
});
// The settings page writes settings.search.* directly; without this mirror
// its changes never reach the live ✦ panel (the sidebar never remounts).
// Same-value writes don't retrigger the outbound watches, so no loop.
watch(
  () => settings.search.cap,
  (cap) => {
    searchLimit.value = cap > 0 ? String(cap) : "all";
  },
);
watch(
  () => ({ ...settings.search.scopes }),
  (scopes) => {
    for (const key of Object.keys(scopes) as (keyof ScopeSet)[]) {
      searchScopes[key] = scopes[key];
    }
  },
);

/** The panel's cap row showing exactly what settings stores (0 renders "all"). */
const searchLimitDefault = computed(() =>
  settings.search.cap > 0 ? String(settings.search.cap) : "all",
);

const parsedQuery = computed(() => parseSearchQuery(query.value));

/** Any filtering active — includes the tag shelf, so pure #bug/is: queries count. */
const queryActive = computed(
  () =>
    parsedQuery.value.includes.length > 0 ||
    parsedQuery.value.excludes.length > 0 ||
    parsedQuery.value.flags.size > 0 ||
    activeTagFilters.value.length > 0,
);

/** Project scope only narrows an active search; with no query it stays a no-op. */
const projectScopeActive = computed(() => queryActive.value && projectScope.value !== "");

/** ✦ lights up while the panel is open or a non-default search is in effect. */
const boostActive = computed(
  () =>
    boostOpen.value ||
    projectScope.value !== "" ||
    searchScopes.body ||
    searchLimit.value !== searchLimitDefault.value ||
    parsedQuery.value.flags.size > 0 ||
    parsedQuery.value.excludes.length > 0 ||
    parsedQuery.value.includes.some((term) => term.scope !== null),
);

const searchPlaceholder = computed(() => {
  const parts = [
    searchScopes.title && t("sidebar.scopeTitle"),
    searchScopes.tag && t("sidebar.scopeTag"),
    searchScopes.body && t("sidebar.scopeBody"),
  ].filter(Boolean);
  return t("sidebar.searchPlaceholder", { parts: parts.join(listSep.value) });
});

/** Any boost option off its out-of-the-box value — the reset button's cue. */
const boostOffDefault = computed(
  () =>
    projectScope.value !== "" ||
    !searchScopes.title ||
    !searchScopes.tag ||
    searchScopes.body ||
    searchLimit.value !== searchLimitDefault.value,
);

/** One click back to title+tag, all projects, the configured cap. */
function resetBoost(): void {
  searchScopes.title = true;
  searchScopes.tag = true;
  searchScopes.body = false;
  projectScope.value = "";
  searchLimit.value = searchLimitDefault.value;
}

// ── body scan (main-process, two-phase) ─────────────────────────────

/** sessionId → up to two snippet hits; body-matched sessions stay listed even without local hits. */
const bodyHits = ref<Map<string, BodySearchHit[]>>(new Map());
/** Sessions whose body contains an exclusion — vetoed everywhere, title hits included. */
const bodyExcluded = ref<Set<string>>(new Set());
const bodyScanning = ref(false);
let searchSequence = 0;
let bodyTimer: ReturnType<typeof setTimeout> | null = null;

function clearBodySearch(): void {
  bodyHits.value = new Map();
  bodyExcluded.value = new Set();
  bodyScanning.value = false;
}

/** Body scan runs when body is checked OR a body: term states the intent outright. */
const bodyScopeWanted = computed(
  () => searchScopes.body || parsedQuery.value.includes.some((term) => term.scope === "body"),
);

/** Number of sessions matched by the local title/tag surfaces before any body results join in. */
const localSearchHitCount = computed(() => {
  const parsed = parsedQuery.value;
  const filters = activeTagFilters.value;
  const scopedDir = projectScopeActive.value ? projectScope.value : null;
  return visibleSessions.value.filter((session) => {
    if (scopedDir !== null && session.directory !== scopedDir) return false;
    const tags = tagsOf(session.id);
    const context = {
      title: session.title,
      tags,
      directory: session.directory,
      pinned: store.pins.includes(session.id),
      fork: session.origin === "fork",
      running: Boolean(store.running[session.id]),
    };
    return (
      gatesOk(parsed, context) &&
      localTextMatched(parsed, context, searchScopes) &&
      filters.every((filter) => tags.includes(filter))
    );
  }).length;
});

/** Plain-text queries fall back to body search only after title/tag matching finds nothing. */
const bodyFallback = computed(() => {
  const parsed = parsedQuery.value;
  return (
    !bodyScopeWanted.value &&
    parsed.includes.length > 0 &&
    parsed.includes.every((term) => term.scope === null) &&
    localSearchHitCount.value === 0
  );
});

/** Debounced dispatch; every call invalidates in-flight results via the sequence. */
function scheduleBodySearch(): void {
  if (bodyTimer !== null) clearTimeout(bodyTimer);
  searchSequence++;
  const parsed = parsedQuery.value;
  const terms = bodyScopeWanted.value
    ? bodySearchTerms(parsed)
    : bodyFallback.value
      ? parsed.includes.map((term) => term.text)
      : null;
  if (terms === null) {
    clearBodySearch();
    return;
  }
  bodyScanning.value = true;
  const token = searchSequence;
  bodyTimer = setTimeout(() => void runBodySearch(token, terms, parsed.excludes), 250);
}

async function runBodySearch(token: number, terms: string[], excludes: string[]): Promise<void> {
  const backend = store.activeBackend;
  const scoped = projectScope.value !== "" && queryActive.value;
  const maxTargets = searchLimit.value === "all" ? Infinity : Number(searchLimit.value);
  const targets = visibleSessions.value
    .filter((session) => !scoped || session.directory === projectScope.value)
    .slice(0, maxTargets)
    .map((session) => ({ id: session.id, updatedAt: session.updatedAt }));
  try {
    const result = await window.awefork.searchMessages(backend, targets, { terms, excludes });
    if (token !== searchSequence || backend !== store.activeBackend) return;
    const bySession = new Map<string, BodySearchHit[]>();
    for (const hit of result.hits) {
      const list = bySession.get(hit.sessionId) ?? [];
      list.push(hit);
      bySession.set(hit.sessionId, list);
    }
    bodyHits.value = bySession;
    bodyExcluded.value = new Set(result.excludedSessionIds);
    bodyScanning.value = false;
  } catch {
    if (token === searchSequence) clearBodySearch();
  }
}

watch(
  [query, () => searchScopes.body, projectScope, searchLimit, bodyFallback],
  scheduleBodySearch,
);
// A backend switch invalidates every hit: ids never collide, but the bodies do.
watch(
  () => store.activeBackend,
  () => {
    clearBodySearch();
    scheduleBodySearch();
  },
);
// Session churn (refresh, streams settling) re-scans only what changed —
// main caches bodies by sessionId+updatedAt.
watch(
  () => visibleSessions.value.map((session) => `${session.id}:${session.updatedAt}`).join("\n"),
  () => {
    if (
      (bodyScopeWanted.value && bodySearchTerms(parsedQuery.value) !== null) ||
      bodyFallback.value
    ) {
      scheduleBodySearch();
    }
  },
);

onUnmounted(() => {
  if (bodyTimer !== null) clearTimeout(bodyTimer);
});

/** Title text split around the first matching term — the row renders <mark> on the hit part. */
function titleSegments(title: string): { text: string; hit: boolean }[] {
  const text = title || "(untitled)";
  const terms = parsedQuery.value.includes.map((term) => term.text);
  const range = terms.length > 0 ? firstMatchRange(text, terms) : null;
  if (range === null) return [{ text, hit: false }];
  return [
    { text: text.slice(0, range.start), hit: false },
    { text: text.slice(range.start, range.start + range.length), hit: true },
    { text: text.slice(range.start + range.length), hit: false },
  ];
}

/** Snippet split around its carried match — same shape as titleSegments. */
function snippetSegments(hit: BodySearchHit): { text: string; hit: boolean }[] {
  const end = hit.matchStart + hit.matchLength;
  return [
    { text: hit.snippet.slice(0, hit.matchStart), hit: false },
    { text: hit.snippet.slice(hit.matchStart, end), hit: true },
    { text: hit.snippet.slice(end), hit: false },
  ];
}

function jumpToHit(hit: BodySearchHit): void {
  void jumpToMessage(hit.sessionId, hit.messageId);
}

/** The whole project list folds under the Project header, Cursor-style. */
const projectsOpen = ref(true);

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
  /** Canvas right-click: rename must reveal the sidebar row first. */
  fromCanvas: boolean;
  /** The session's directory — opens its group when revealing the row. */
  directory: string | null;
  /** The right-clicked turn card's id when it can take a key-turn mark. */
  turnId: string | null;
} | null>(null);
const renaming = ref<{ sessionId: string; title: string } | null>(null);
const renameText = ref("");
const dirMenu = ref<{ directory: string; x: number; y: number } | null>(null);
/** Right-clicked shelf tag awaiting delete confirmation. */
const shelfTagMenu = ref<{ tag: string; x: number; y: number } | null>(null);

function openMenu(
  session: SessionSummary,
  x: number,
  y: number,
  fromCanvas = false,
  turnId: string | null = null,
): void {
  dirMenu.value = null;
  shelfTagMenu.value = null;
  menu.value = {
    sessionId: session.id,
    title: session.title,
    x,
    y,
    fromCanvas,
    directory: session.directory,
    turnId,
  };
  placeAndFocusMenu();
}

const menuPinned = computed(() => {
  const active = menu.value;
  return active != null && store.pins.includes(active.sessionId);
});

function togglePinFromMenu(): void {
  const active = menu.value;
  if (!active) return;
  closeMenu();
  void togglePin(active.sessionId);
}

/** The menu's turn card, resolved live so marking tracks the current graph. */
const menuTurn = computed(() => {
  const id = menu.value?.turnId;
  if (!id) return null;
  return turnGraph.value.nodes.find((n) => n.id === id && n.kind === "turn") ?? null;
});

const menuMarked = computed(() => (menuTurn.value ? isTurnMarked(menuTurn.value.id) : false));

/** Comparisons pair sessions of one directory, so the entry only shows for those. */
const menuInDirectory = computed(() => {
  const id = menu.value?.sessionId;
  return id != null && directorySessions.value.some((s) => s.id === id);
});

function compareFromMenu(): void {
  const id = menu.value?.sessionId;
  closeMenu();
  if (id) beginComparePick(id);
}

/**
 * Pick mode reroutes a row click: a different session completes the ⇄ pair
 * (any story in the directory — the canvas can only offer the current one),
 * the armed session's own row cancels. Other rows select as usual.
 */
function onRowClick(sessionId: string): void {
  const from = store.comparePickFrom;
  if (from == null || !directorySessions.value.some((s) => s.id === sessionId)) {
    void openSession(sessionId, { focus: true });
    return;
  }
  if (sessionId === from) {
    cancelComparePick();
    return;
  }
  void enterCompare(from, sessionId);
}

/** Middle-click opens the story in a new canvas tab, browser-style. */
function onRowAuxClick(sessionId: string, event: MouseEvent): void {
  if (event.button !== 1) return;
  event.preventDefault();
  void openCanvasTab(sessionId);
}

function openInNewTabFromMenu(): void {
  const id = menu.value?.sessionId;
  closeMenu();
  if (id) void openCanvasTab(id);
}

function toggleMarkFromMenu(): void {
  const node = menuTurn.value;
  if (!node) return;
  closeMenu();
  void toggleTurnMark(node);
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
    openMenu(session, request.x, request.y, true, request.turnId);
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
  if (active.fromCanvas) revealSessionRow(active.sessionId, active.directory);
  renameInputArmed = true;
  renaming.value = { sessionId: active.sessionId, title: active.title };
  renameText.value = active.title;
}

/** A canvas-originated rename edits the sidebar row inline, so that row must
 * be reachable: un-collapse the panel, open the session's directory group and
 * unfold any collapsed branch above it. */
function revealSessionRow(sessionId: string, directory: string | null): void {
  const panel = panels.sidebar;
  if (panel.collapsed) {
    panel.collapsed = false;
    panel.width = panel.saved;
    persistLayout();
  }
  if (directory && !isDirOpen(directory)) {
    expandedOverride.value = { ...expandedOverride.value, [directory]: true };
  }
  expandAncestorsOf(sessionId);
}

function cancelRename(): void {
  renaming.value = null;
}

/** Enter during IME composition confirms a candidate word instead of submitting
 * the rename (see chat-input's onEnterKey). */
function onRenameEnter(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  commitRename();
}

/** Esc during IME composition closes the candidate window; the first press must
 * not also close the rename. */
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

/**
 * Copy the branch out as a standalone native session. A turn-card right
 * click bounds the copy through that turn; a sidebar row exports the whole
 * session at its tip.
 */
function exportFromMenu(): void {
  const active = menu.value;
  if (!active) return;
  const atMessageId = menuTurn.value?.messageId ?? null;
  closeMenu();
  void exportSessionAt(active.sessionId, atMessageId);
}

/**
 * Compress at the menu's own position: a turn-card right click bounds the
 * summary through that turn — a mid-story cut lands the summary in a fresh
 * fork at that node — while a sidebar row compresses the session at its tip.
 */
function compressFromMenu(): void {
  const active = menu.value;
  if (!active) return;
  const atMessageId = menuTurn.value?.messageId ?? null;
  closeMenu();
  void compressSession(active.sessionId, atMessageId);
}

/** Same soft delete as the canvas 🗑 chip; deleteSession owns the confirm. */
function beginDelete(): void {
  const active = menu.value;
  if (!active) return;
  closeMenu();
  void deleteSession(active.sessionId);
}

// ── tag editor (right-click → set tag) ─────────────────────────────────────

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
const newTagAutoHue = computed(() => hueOf(newTagText.value.trim() || "new tag"));

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
  subtreeAsk.value = null;
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
  // An unanswered ask dies with the menu — those tags stay on this session only.
  subtreeAsk.value = null;
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
async function confirmDelLocal(tag: string): Promise<void> {
  const active = tagMenu.value;
  delConfirm.value = null;
  if (!active) return;
  const prev = [...draftTags.value];
  draftTags.value = draftTags.value.filter((t) => t !== tag);
  if (await setSessionTags(active.sessionId, draftTags.value)) {
    refreshSubtreeAsk(active.sessionId, prev, draftTags.value);
  }
}

/**
 * Delete the tag everywhere; a filter sitting on it clears via the watcher.
 * The toast in state offers Undo for a few seconds after.
 */
function confirmDelAll(tag: string): void {
  delConfirm.value = null;
  colorEdit.value = null;
  // Gone from the draft too, or a queued checkbox write could resurrect it.
  draftTags.value = draftTags.value.filter((t) => t !== tag);
  // A globally deleted tag must not ride a pending subtree apply back in.
  if (subtreeAsk.value) {
    const tags = subtreeAsk.value.tags.filter((t) => t !== tag);
    subtreeAsk.value = tags.length > 0 ? { ...subtreeAsk.value, tags } : null;
  }
  void deleteTag(tag);
}

/**
 * Rule A inline ask: tags this menu's saves ADDED to a session that has a
 * fork subtree, not yet applied or declined. Each new add merges in, so
 * checking three tags still answers one question; a later removal drops the
 * tag back out — the ask never offers a tag the session no longer carries.
 */
const subtreeAsk = ref<{ tags: string[]; count: number } | null>(null);

/** Fold one successful save into the pending ask: adds merge in, removals drop out. */
function refreshSubtreeAsk(
  sessionId: string,
  prev: readonly string[],
  next: readonly string[],
): void {
  const merged = (subtreeAsk.value?.tags ?? []).filter(
    (tag) => !(prev.includes(tag) && !next.includes(tag)),
  );
  for (const tag of next) {
    if (!prev.includes(tag) && !merged.includes(tag)) merged.push(tag);
  }
  if (merged.length === 0) {
    subtreeAsk.value = null;
    return;
  }
  const count = subtreeSessionIds(sessionId).size;
  subtreeAsk.value = count > 0 ? { tags: merged, count } : null;
}

function answerSubtreeApply(): void {
  const ask = subtreeAsk.value;
  const active = tagMenu.value;
  subtreeAsk.value = null;
  if (ask && active) void applyTagsToSubtree(active.sessionId, ask.tags);
}

function answerSubtreeSkip(): void {
  subtreeAsk.value = null;
}

async function toggleDraftTag(tag: string): Promise<void> {
  const active = tagMenu.value;
  if (!active) return;
  const prev = [...draftTags.value];
  draftTags.value = draftTags.value.includes(tag)
    ? draftTags.value.filter((t) => t !== tag)
    : [...draftTags.value, tag];
  if (await setSessionTags(active.sessionId, draftTags.value)) {
    refreshSubtreeAsk(active.sessionId, prev, draftTags.value);
  }
}

async function addNewTag(): Promise<void> {
  const active = tagMenu.value;
  const tag = newTagText.value.trim();
  if (!active || !tag) return;
  let attached = draftTags.value.includes(tag);
  if (!draftTags.value.includes(tag)) {
    const prev = [...draftTags.value];
    draftTags.value = [...draftTags.value, tag];
    attached = await setSessionTags(active.sessionId, draftTags.value);
    if (attached) refreshSubtreeAsk(active.sessionId, prev, draftTags.value);
  }
  if (attached && newTagHue.value !== null) void setTagColor(tag, newTagHue.value);
  newTagText.value = "";
  newTagHue.value = null;
}

/** The menu session's fork-inheritance preference; null = ask every fork. */
const forkPref = computed<boolean | null>(() =>
  tagMenu.value ? forkTagPrefOf(tagMenu.value.sessionId) : null,
);

function setPref(pref: boolean | null): void {
  const active = tagMenu.value;
  if (active) void setForkTagPref(active.sessionId, pref);
}

/** Archive is fully reversible — no confirm, the archive section undoes it. */
function beginArchive(): void {
  const active = menu.value;
  if (!active) return;
  closeMenu();
  void archiveSession(active.sessionId);
}

/** Right-click create: the new session lands in this directory and becomes
 * the open project — createSession's landing logic opens it on screen. */
function beginDirCreate(): void {
  const active = dirMenu.value;
  if (!active) return;
  closeMenu();
  void createSession(active.directory);
}

/** Sessions under a path across every view filter — decides which dir-menu
 * items apply: archiving needs rows to hide, a standing folder is cleared. */
function dirSessionCount(directory: string): number {
  const group = sessionGroups.value.find((g) => g.directory === directory);
  return group ? flattenSessionTree(group.roots, () => false).length : 0;
}

const isResident = isResidentFolder;

/** Stand this directory up as the resident folder — the pin, no navigation. */
function beginDirSetResident(): void {
  const active = dirMenu.value;
  if (!active) return;
  closeMenu();
  setResidentFolder(active.directory);
}

/** Drop the standing folder; the row leaves the sidebar. */
function beginDirClearResident(): void {
  const active = dirMenu.value;
  if (!active) return;
  closeMenu();
  void clearResidentFolder();
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
  // Both paths under openSession switch the directory themselves when the
  // star lives elsewhere.
  void openSession(session.id, { focus: true });
}

function unpinFavorite(sessionId: string): void {
  void togglePin(sessionId);
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

/** The rename input mounts focused with its text selected, so typing replaces
 * the old title. The function ref re-fires on every patch while v-model types
 * into it, so it is armed once per rename — otherwise each keystroke would
 * re-select everything just typed. select() waits one tick because v-model's
 * mounted hook re-assigns el.value after this ref and would collapse it. */
let renameInputArmed = false;

function focusRenameInput(el: unknown): void {
  const input = el as HTMLInputElement | null;
  if (!input || !renameInputArmed) return;
  renameInputArmed = false;
  input.focus();
  void nextTick(() => input.select());
}

function onDocMousedown(): void {
  pendingAction.value = null;
  closeMenu();
  boostOpen.value = false;
}

function onDocKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
  if (
    !pendingAction.value &&
    !menu.value &&
    !dirMenu.value &&
    !tagMenu.value &&
    !shelfTagMenu.value &&
    !boostOpen.value
  )
    return;
  event.preventDefault();
  pendingAction.value = null;
  closeMenu();
  boostOpen.value = false;
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
  if (queryActive.value) return true;
  const override = expandedOverride.value[directory];
  return override ?? directory === selectedDirectory.value;
}

function isOpen(group: SessionGroup): boolean {
  return isDirOpen(group.directory);
}

function toggleDir(directory: string): void {
  expandedOverride.value = { ...expandedOverride.value, [directory]: !isDirOpen(directory) };
}

function armRowAction(sessionId: string, kind: "pin" | "archive"): void {
  pendingAction.value = { sessionId, kind };
}

function confirmRowAction(sessionId: string, kind: "pin" | "archive"): void {
  if (pendingAction.value?.sessionId !== sessionId || pendingAction.value.kind !== kind) return;
  pendingAction.value = null;
  if (kind === "pin") void togglePin(sessionId);
  else void archiveSession(sessionId);
}

const visibleGroups = computed<SessionGroup[]>(() => {
  const parsed = parsedQuery.value;
  const filters = activeTagFilters.value;
  if (!queryActive.value) return sessionGroups.value;
  const hitIds = bodyHits.value;
  // Project scope is a top-level gate, not a per-session match: it prunes the
  // group list before the body/local matchers run, so a scoped search only
  // renders its target directory's group.
  const scopedDir = projectScopeActive.value ? projectScope.value : null;
  return (
    sessionGroups.value
      .filter((group) => scopedDir === null || group.directory === scopedDir)
      .map((group) => {
        const keep = (node: SessionTreeNode): SessionTreeNode | null => {
          const children = node.children.map(keep).filter((n): n is SessionTreeNode => n !== null);
          const tags = tagsOf(node.session.id);
          const context = {
            title: node.session.title,
            tags,
            directory: node.session.directory,
            pinned: store.pins.includes(node.session.id),
            fork: node.session.origin === "fork",
            running: Boolean(store.running[node.session.id]),
          };
          // Gates fail the session everywhere; body exclusions veto title hits too.
          const gateHit = gatesOk(parsed, context) && !bodyExcluded.value.has(node.session.id);
          // With no include terms this is a pure filter (tags/flags/dir) — gates decide.
          const textHit =
            parsed.includes.length === 0
              ? true
              : localTextMatched(parsed, context, searchScopes) ||
                ((bodyScopeWanted.value || bodyFallback.value) && hitIds.has(node.session.id));
          const filterHit = filters.every((f) => tags.includes(f));
          return gateHit && textHit && filterHit
            ? { ...node, children }
            : children.length > 0
              ? { ...node, children }
              : null;
        };
        const roots = group.roots.map(keep).filter((n): n is SessionTreeNode => n !== null);
        return { directory: group.directory, roots };
      })
      // Empty groups (hand-added directories) survive only the unfiltered
      // view — a search or tag filter is asking for conversations, not homes.
      .filter((group) => group.roots.length > 0)
  );
});

// ── branch collapse (collapse a fork subtree) ────────────────────────────────

/** Session ids whose subtree the user folded; everything renders open by default. */
const collapsedBranches = ref<Record<string, true>>({});

/** While a search is active the whole tree must be walkable, so folds are ignored. */
function isBranchCollapsed(sessionId: string): boolean {
  return !queryActive.value && collapsedBranches.value[sessionId] === true;
}

function toggleBranch(sessionId: string): void {
  // Flip the stored fold, not the search-masked visibility — isBranchCollapsed
  // is forced false during a search, which would make every click a "fold".
  const next = { ...collapsedBranches.value };
  if (next[sessionId] === true) delete next[sessionId];
  else next[sessionId] = true;
  collapsedBranches.value = next;
}

/** Strict ancestors of a session within the sidebar tree, root-first. */
function ancestorsInTree(sessionId: string): string[] {
  const path: string[] = [];
  const visit = (nodes: SessionTreeNode[]): boolean => {
    for (const node of nodes) {
      if (node.session.id === sessionId) return true;
      path.push(node.session.id);
      if (visit(node.children)) return true;
      path.pop();
    }
    return false;
  };
  for (const group of sessionGroups.value) {
    if (visit(group.roots)) return [...path];
  }
  return [];
}

/** Unfold every branch between the root and this session so its row is
 * visible — the session's own fold hides its children, not itself, so it
 * must survive the reveal. */
function expandAncestorsOf(sessionId: string): void {
  const ancestors = ancestorsInTree(sessionId);
  if (ancestors.every((id) => collapsedBranches.value[id] !== true)) return;
  const next = { ...collapsedBranches.value };
  for (const id of ancestors) delete next[id];
  collapsedBranches.value = next;
}

// Opening a session from the canvas or favorites must reveal its row: unfold
// whatever ancestors the user had folded.
watch(selectedId, (id) => {
  if (id) expandAncestorsOf(id);
});

function visibleRows(group: SessionGroup): FlatSessionRow[] {
  return flattenSessionTree(group.roots, isBranchCollapsed);
}

/** Directory and branch counts ignore folds — the badges show every session. */
function countSessions(group: SessionGroup): number {
  return flattenSessionTree(group.roots, () => false).length;
}

function selectDirectory(directory: string): void {
  expandedOverride.value = { ...expandedOverride.value, [directory]: true };
  void switchDirectory(directory);
}

async function emitRefresh(): Promise<void> {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await refreshSessions();
  } finally {
    refreshing.value = false;
  }
}
/** Per-directory ＋: the new conversation lands in that project directly. */
function emitCreateIn(directory: string): void {
  void createSession(directory);
}
function emitChooseResident(): void {
  void chooseResidentFolder();
}
</script>
