<template>
  <aside class="sidebar">
    <div class="search-row">
      <div class="search">
        <span>⌕</span>
        <input
          ref="searchInputEl"
          v-model="query"
          type="text"
          :placeholder="searchPlaceholder"
          aria-label="搜索会话"
        />
        <button
          v-if="query.length > 0"
          type="button"
          class="search-clear"
          title="清空搜索文本"
          aria-label="清空搜索文本"
          @click="clearQuery"
        >✕</button>
        <button
          type="button"
          class="search-boost"
          :class="{ on: boostActive }"
          :title="boostOpen ? '收起增强搜索' : '增强搜索：范围、标签、状态筛选'"
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
        title="刷新会话列表"
        aria-label="刷新会话列表"
        @click="emitRefresh"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 11a8 8 0 0 0-14.9-4L3 10m0-6v6h6M4 13a8 8 0 0 0 14.9 4l2.1-3m0 6v-6h-6" />
        </svg>
      </button>
    </div>
    <div v-if="boostOpen" class="boost-menu" @mousedown.stop>
      <div class="boost-head">搜索范围</div>
      <div class="boost-scopes">
        <label class="boost-opt"><input v-model="searchScopes.title" type="checkbox" />标题</label>
        <label class="boost-opt"><input v-model="searchScopes.tag" type="checkbox" />标签</label>
        <label class="boost-opt"
          ><input v-model="searchScopes.body" type="checkbox" />正文·全文</label
        >
      </div>
      <div class="boost-head">项目</div>
      <div class="boost-project">
        <select v-model="projectScope" aria-label="把搜索限定到某个项目">
          <option value="">全部项目</option>
          <option v-for="dir in projectOptions" :key="dir" :value="dir">
            {{ shortPath(dir) }}
          </option>
        </select>
      </div>
      <div class="boost-head">搜索上限</div>
      <div class="boost-scopes">
        <label class="boost-opt"><input v-model="searchLimit" type="radio" value="100" /> 100</label>
        <label class="boost-opt"><input v-model="searchLimit" type="radio" value="300" /> 300</label>
        <label class="boost-opt"><input v-model="searchLimit" type="radio" value="1000" /> 1000</label>
        <label class="boost-opt"><input v-model="searchLimit" type="radio" value="all" /> 全部</label>
      </div>
      <div class="boost-head">语法</div>
      <dl class="boost-syntax">
        <dt><code>body:词</code></dt>
        <dd>只搜会话正文</dd>
        <dt><code>#标签</code></dt>
        <dd>限定标签</dd>
        <dt><code>title:词</code></dt>
        <dd>限定标题</dd>
        <dt><code>dir:目录</code></dt>
        <dd>限定目录</dd>
        <dt><code>"精确短语"</code></dt>
        <dd>整句匹配</dd>
        <dt><code>-词</code></dt>
        <dd>排除含它的结果</dd>
      </dl>
      <p class="boost-note">勾选正文后：标题命中立即显示，正文命中扫描完成后补上。</p>
      <button
        v-if="boostOffDefault"
        type="button"
        class="boost-reset"
        title="范围、项目、上限全部还原成默认"
        @click="resetBoost"
      >↺ 恢复默认搜索</button>
    </div>
    <p v-if="bodyScanning" class="body-scan">⟳ 正在搜索正文…</p>
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
        <span>📌 置顶</span>
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
            <span class="fav-time">{{ relTime(sess.updatedAt) }}</span>
          </button>
          <button
            type="button"
            class="fav-unpin"
            title="取消置顶"
            aria-label="取消置顶"
            @click="unpinFavorite(sess.id)"
          >×</button>
        </div>
      </div>
    </div>
    <div class="proj-head">
      <button
        type="button"
        class="head-caret"
        :title="projectsOpen ? '收起项目列表' : '展开项目列表'"
        :aria-expanded="projectsOpen"
        @click="projectsOpen = !projectsOpen"
      >{{ projectsOpen ? "▾" : "▸" }}</button>
      <button type="button" class="head-label" @click="projectsOpen = !projectsOpen">项目</button>
      <span class="head-actions">
        <button
          type="button"
          class="head-icon"
          title="选择一个项目目录加进侧栏，可在其中新建对话"
          @click="emitAddDir"
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
          <button
            type="button"
            class="proj-add"
            title="在这个项目里新建对话"
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
                :title="
                  isBranchCollapsed(row.session.id)
                    ? `展开这个分支（折叠了 ${row.descendantCount} 个子会话）`
                    : '收起这个分支的子会话'
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
                @contextmenu.prevent="openMenu(row.session, $event.clientX, $event.clientY)"
              >
                <span class="dot"></span>
                <span v-if="row.session.origin === 'fork'" class="fork-glyph">⎇</span>
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
                v-if="pendingAction?.sessionId === row.session.id && pendingAction.kind === 'pin'"
                type="button"
                class="sess-confirm"
                :title="store.pins.includes(row.session.id) ? '确认取消置顶' : '确认置顶'"
                @mousedown.stop
                @click.stop="confirmRowAction(row.session.id, 'pin')"
              >确认</button>
              <button
                v-else
                type="button"
                class="pin-star"
                :class="{ on: store.pins.includes(row.session.id) }"
                :title="store.pins.includes(row.session.id) ? '取消置顶' : '置顶'"
                @mousedown.stop
                @click.stop="armRowAction(row.session.id, 'pin')"
              >{{ store.pins.includes(row.session.id) ? "★" : "☆" }}</button>
              <button
                v-if="pendingAction?.sessionId === row.session.id && pendingAction.kind === 'archive'"
                type="button"
                class="sess-confirm"
                title="确认归档会话"
                @mousedown.stop
                @click.stop="confirmRowAction(row.session.id, 'archive')"
              >确认</button>
              <button
                v-else
                type="button"
                class="sess-archive"
                title="归档会话（在下方归档区可恢复）"
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
                title="定位到这条消息所在的回合"
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
      <p v-if="visibleGroups.length === 0 && !bodyScanning" class="group-empty">没有匹配的会话</p>
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
      <!-- 置顶只留在侧边栏会话行的菜单里；画布右键不提供 -->
      <button
        v-if="!menu.fromCanvas"
        type="button"
        role="menuitem"
        class="ctx-menu-item"
        @click="togglePinFromMenu"
      >
        {{ menuPinned ? "★ 取消置顶" : "☆ 置顶" }}
      </button>
      <button
        v-if="menu.turnId"
        type="button"
        role="menuitem"
        class="ctx-menu-item"
        @click="toggleMarkFromMenu"
      >
        {{ menuMarked ? "★ 取消关键标记" : "☆ 标记为关键对话" }}
      </button>
      <button type="button" role="menuitem" class="ctx-menu-item" @click="beginRename">✏️ 重命名</button>
      <button type="button" role="menuitem" class="ctx-menu-item" @click="openTagMenu">🏷 设置标签…</button>
      <button
        v-if="menuInDirectory"
        type="button"
        role="menuitem"
        class="ctx-menu-item"
        title="点画布上的一张卡片，或在侧栏点一个会话，与它并排对比"
        @click="compareFromMenu"
      >⇄ 与另一会话对比…</button>
      <button type="button" role="menuitem" class="ctx-menu-item" @click="copySessionId">📋 复制会话 ID</button>
      <button type="button" role="menuitem" class="ctx-menu-item" @click="openInTerminal">↗ 在终端中打开</button>
      <button
        v-if="store.capabilities.exportBranch"
        type="button"
        role="menuitem"
        class="ctx-menu-item"
        :title="menuTurn ? '把这个分支截至当前回合复制成一份独立会话，可在任何 opencode 客户端继续' : '把这条分支复制成一份独立会话，可在任何 opencode 客户端继续'"
        @click="exportFromMenu"
      >📤 导出为独立会话</button>
      <button type="button" role="menuitem" class="ctx-menu-item" @click="beginArchive">📦 归档会话</button>
      <button
        v-if="store.capabilities.deleteSession"
        type="button"
        role="menuitem"
        class="ctx-menu-item danger"
        @click="beginDelete"
      >
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
      <button type="button" role="menuitem" class="ctx-menu-item" @click="beginDirCreate">
        ＋ 在此目录新建对话
      </button>
      <button
        v-if="dirSessionCount(dirMenu.directory) > 0"
        type="button"
        role="menuitem"
        class="ctx-menu-item"
        @click="beginDirArchive"
      >
        📦 归档这个目录…
      </button>
      <button
        v-else
        type="button"
        role="menuitem"
        class="ctx-menu-item"
        title="只从侧栏移除这个空目录，不动磁盘"
        @click="beginDirRemove"
      >
        ✕ 移除这个目录
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
      <div v-if="subtreeAsk" class="tag-menu-subtree" @mousedown.stop>
        <span class="subtree-text"
          >也把「{{ subtreeAsk.tags.join("、") }}」应用到 {{ subtreeAsk.count }} 个子会话？</span
        >
        <div class="subtree-btns">
          <button
            type="button"
            class="subtree-btn apply"
            title="把这些标签并集写入每个子孙会话（可撤销）"
            @click="answerSubtreeApply"
            >应用</button
          >
          <button
            type="button"
            class="subtree-btn"
            title="这些标签只留在当前会话上"
            @click="answerSubtreeSkip"
            >仅本会话</button
          >
        </div>
      </div>
      <div v-if="draftTags.length > 0" class="tag-menu-pref" @mousedown.stop>
        <span class="pref-label">分叉时继承标签</span>
        <div class="pref-options" role="radiogroup" aria-label="分叉时继承标签">
          <button
            type="button"
            :class="{ active: forkPref === null }"
            title="每次分叉都询问是否继承"
            @click="setPref(null)"
            >每次问</button
          >
          <button
            type="button"
            :class="{ active: forkPref === true }"
            title="分叉出的新会话自动带上本会话的全部标签"
            @click="setPref(true)"
            >始终</button
          >
          <button
            type="button"
            :class="{ active: forkPref === false }"
            title="分叉出的新会话不带标签，也不再询问"
            @click="setPref(false)"
            >从不</button
          >
        </div>
      </div>
    </div>
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
import { panels, persistLayout } from "../layout";
import {
  addDirectory,
  allTags,
  applyTagsToSubtree,
  archiveDirectory,
  archivedDirectoryViews,
  archivedSessionViews,
  archiveSession,
  beginComparePick,
  cancelComparePick,
  createSession,
  deleteSession,
  deleteTag,
  directorySessions,
  enterCompare,
  exportSessionAt,
  favoriteSessions,
  forkTagPrefOf,
  hueOf,
  isTurnMarked,
  jumpToMessage,
  openSessionTerminal,
  recentAlphaFor,
  refreshSessions,
  removeDirectory,
  renameSession,
  restoreDirectory,
  restoreSession,
  selectSession,
  sessionGroups,
  setForkTagPref,
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

/** Which surfaces plain terms search; 正文 is opt-in (a scan costs a round-trip per session). */
const searchScopes = reactive<ScopeSet>({ title: true, tag: true, body: false });
const boostOpen = ref(false);

/** Pin a search to one project directory. Empty = search every project (default). */
const projectScope = ref<string>("");
/** Options: every directory the sidebar knows about, in session-recency order. */
const projectOptions = computed(() => sessionGroups.value.map((group) => group.directory));
/** How many sessions to scan for body hits; "all" means no cap. */
const searchLimit = ref<string>("1000");

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
    searchLimit.value !== "1000" ||
    parsedQuery.value.flags.size > 0 ||
    parsedQuery.value.excludes.length > 0 ||
    parsedQuery.value.includes.some((term) => term.scope !== null),
);

const searchPlaceholder = computed(() => {
  const parts = [
    searchScopes.title && "标题",
    searchScopes.tag && "标签",
    searchScopes.body && "正文",
  ].filter(Boolean);
  return `搜索${parts.join("、")}…`;
});

/** Any boost option off its out-of-the-box value — the reset button's cue. */
const boostOffDefault = computed(
  () =>
    projectScope.value !== "" ||
    !searchScopes.title ||
    !searchScopes.tag ||
    searchScopes.body ||
    searchLimit.value !== "1000",
);

/** One click back to 标题+标签、全部项目、上限 1000. */
function resetBoost(): void {
  searchScopes.title = true;
  searchScopes.tag = true;
  searchScopes.body = false;
  projectScope.value = "";
  searchLimit.value = "1000";
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

/** Body scan runs when 正文 is checked OR a body: term states the intent outright. */
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

/** The whole project list folds under the 项目 header, Cursor-style. */
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
  /** Canvas right-click: 重命名 must reveal the sidebar row first. */
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
    void selectSession(sessionId, { focus: true });
    return;
  }
  if (sessionId === from) {
    cancelComparePick();
    return;
  }
  void enterCompare(from, sessionId);
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
 * The toast in state offers 撤销 for a few seconds after.
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
 * the open project — selectSession inside createSession switches to it. */
function beginDirCreate(): void {
  const active = dirMenu.value;
  if (!active) return;
  closeMenu();
  void createSession(active.directory);
}

/** Sessions under a path across every view filter — decides which dir-menu
 * items apply: archiving needs rows to hide, removal empties the group. */
function dirSessionCount(directory: string): number {
  const group = sessionGroups.value.find((g) => g.directory === directory);
  return group ? flattenSessionTree(group.roots, () => false).length : 0;
}

/** Only offered on empty groups: forgetting the registration hides the row,
 * and no session data moves — the disk directory is untouched. */
function beginDirRemove(): void {
  const active = dirMenu.value;
  if (!active) return;
  closeMenu();
  void removeDirectory(active.directory);
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

/** Function ref: focus (and select) the rename input the moment it mounts. */
function focusRenameInput(el: unknown): void {
  const input = el as HTMLInputElement | null;
  if (input) {
    input.focus();
    input.select();
  }
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

// ── branch collapse (折叠 fork 子树) ────────────────────────────────

/** Session ids whose subtree the user folded; everything renders open by default. */
const collapsedBranches = ref<Record<string, true>>({});

/** While a search is active the whole tree must be walkable, so folds are ignored. */
function isBranchCollapsed(sessionId: string): boolean {
  return !queryActive.value && collapsedBranches.value[sessionId] === true;
}

function toggleBranch(sessionId: string): void {
  const next = { ...collapsedBranches.value };
  if (isBranchCollapsed(sessionId)) delete next[sessionId];
  else next[sessionId] = true;
  collapsedBranches.value = next;
}

/** Ancestor chain of a session within the sidebar tree, nearest parent first. */
function ancestorsInTree(sessionId: string): string[] {
  const path: string[] = [];
  const visit = (nodes: SessionTreeNode[]): boolean => {
    for (const node of nodes) {
      path.push(node.session.id);
      if (node.session.id === sessionId) return true;
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

/** Unfold every branch between the root and this session so its row is visible. */
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
function emitAddDir(): void {
  void addDirectory();
}
</script>
