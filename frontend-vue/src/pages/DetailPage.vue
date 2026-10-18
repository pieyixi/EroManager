<script setup lang="ts">
import { detailTransitionSource, detailTransitionDirection, coverFlightVisible, stableDetailPages, registerDetailCover } from "../features/shell/detailTransition";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { playerCommands } from "../features/player/commands";
import type { TagSummary } from "../api/contracts/library";
import { type FilterKey, useLibraryStore } from "../stores/library";
import { type EhFilterKey, ehDisplayValues, useEhLibraryStore } from "../stores/ehLibrary";
import { useEhReaderStore } from "../stores/ehReader";
import { useNavigationStore } from "../stores/navigation";

const coverElement = ref<HTMLElement | null>(null);
const coverImage = ref<HTMLImageElement | null>(null);
watch([coverElement, coverImage], ([element, image]) => registerDetailCover('detail', element, image), { flush: 'post' });
onBeforeUnmount(() => registerDetailCover('detail', null));
const library = useLibraryStore();
const ehLibrary = useEhLibraryStore();
const ehReader = useEhReaderStore();
const navigation = useNavigationStore();
const detail = computed(() => library.currentDetail);
const work = computed(() => detail.value?.work);
const isEhDetail = computed(() => navigation.detailSource === "eh");
const ehGallery = computed(() =>
  isEhDetail.value ? ehLibrary.currentGallery : null,
);
const displayTitle = computed(
  () => ehGallery.value?.title || work.value?.title || "",
);
const displayCoverPath = computed(
  () => ehGallery.value?.cover_path || work.value?.cover_path || "",
);
const displayFolderPath = computed(
  () => ehGallery.value?.folder_path || work.value?.folder_path || "",
);
const displayCoverUrl = computed(() =>
  isEhDetail.value
    ? ehLibrary.coverUrl(displayCoverPath.value)
    : library.coverUrl(displayCoverPath.value),
);
const episodes = computed(() => detail.value?.episodes || []);

type DetailTag = Pick<TagSummary, "name" | "category"> & { id?: number; rawName?: string };

interface DetailRow {
  label: string;
  tags: DetailTag[];
  filter?: FilterKey;
  ehFilter?: EhFilterKey;
}

const detailRows = computed<DetailRow[]>(() => {
  if (isEhDetail.value && ehGallery.value) {
    const gallery = ehGallery.value;
    return [
      { label: "作品号", tags: [{ name: `${gallery.source === 'hitomi' ? 'Hitomi' : 'Ehentai'} · ${gallery.source_id || Math.abs(gallery.gid)}`, category: "作品号" }] },
      {
        label: "画师",
        tags: gallery.artist.map((rawName, index) => ({ name: ehDisplayValues(gallery, "artist")[index] || rawName, rawName, category: "画师" })),
        ehFilter: "artist" as EhFilterKey,
      },
      {
        label: "社团",
        tags: gallery.group.map((rawName, index) => ({
          name: ehDisplayValues(gallery, "group")[index] || rawName,
          rawName,
          category: "社团",
        })),
        ehFilter: "group" as EhFilterKey,
      },
      {
        label: "Tag",
        tags: gallery.tags.map((rawName, index) => ({ name: ehDisplayValues(gallery, "tag")[index] || rawName, rawName, category: "Tag" })),
        ehFilter: "tag" as EhFilterKey,
      },
    ].filter((row) => row.tags.length);
  }
  if (!detail.value || !work.value) return [];
  const tags = detail.value.tags || [];
  let characters = (detail.value.characters || []).map((name) => ({
    name,
    category: "人物",
  }));
  if (!characters.length)
    characters = tags.filter((tag) => tag.category === "人物");
  const fallbackDate = `${work.value.year}-${String(work.value.month).padStart(2, "0")}`;
  const sourceDates = work.value.release_dates?.length
    ? work.value.release_dates
    : episodes.value.map((episode) => episode.release_date || fallbackDate);
  const dates = [...new Set(sourceDates.filter(Boolean))];
  const rows: DetailRow[] = [
    { label: "年份", tags: dates.map((name) => ({ name, category: "年份" })) },
  ];
  if (characters.length) rows.push({ label: "角色", tags: characters });
  if (work.value.studio)
    rows.push({
      label: "制作商",
      tags: [{ name: work.value.studio, category: "制作" }],
      filter: "studio",
    });
  const categories: Array<[string, string, FilterKey]> = [
    ["剧情", "剧情", "story"],
    ["属性", "属性", "attr"],
    ["场景", "场景", "scene"],
  ];
  categories.forEach(([label, category, filter]) => {
    const matches = tags.filter((tag) => tag.category === category);
    if (matches.length) rows.push({ label, tags: matches, filter });
  });
  return rows;
});

const synopsis = computed(() =>
  String(work.value?.description || "（暂无简介）")
    .replace(/\\n/g, "\n")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const chunks: Array<{ text: string; strong: boolean }> = [];
      let cursor = 0;
      const pattern = /\*\*(.+?)\*\*/g;
      for (
        let match = pattern.exec(line);
        match !== null;
        match = pattern.exec(line)
      ) {
        if (match.index > cursor)
          chunks.push({ text: line.slice(cursor, match.index), strong: false });
        chunks.push({ text: match[1], strong: true });
        cursor = pattern.lastIndex;
      }
      if (cursor < line.length)
        chunks.push({ text: line.slice(cursor), strong: false });
      return chunks;
    }),
);

function imageError(event: Event): void {
  (event.currentTarget as HTMLImageElement).style.display = "none";
}

function handleTagClick(row: DetailRow, tag: DetailTag): void {
  if (isEhDetail.value && row.label === "作品号" && ehGallery.value) {
    void ehLibrary.toggleFavorite(ehGallery.value.gid);
  } else if (isEhDetail.value && row.ehFilter && ehGallery.value) {
    const value = row.ehFilter === "category" ? String(ehGallery.value.category) : tag.rawName || tag.name;
    ehLibrary.jumpToSingleFilter(row.ehFilter, value);
  } else if (row.label === "角色") {
    void library.toggleFavoriteCharacter(tag.name);
  } else if (row.filter) {
    library.jumpToSingleFilter(row.filter, tag.name);
  }
}

function tagTitle(row: DetailRow, tag: DetailTag): string | undefined {
  if (row.label === "作品号" && ehGallery.value)
    return ehLibrary.isFavorite(ehGallery.value.gid) ? "取消收藏作品" : "收藏作品";
  if (row.label !== "角色") return undefined;
  return library.isFavoriteCharacter(tag.name) ? "取消收藏角色" : "收藏角色";
}

function isFavoritable(row: DetailRow): boolean {
  return row.label === "角色" || (isEhDetail.value && row.label === "作品号");
}

function isFavoriteTag(row: DetailRow, tag: DetailTag): boolean {
  if (row.label === "作品号" && ehGallery.value) return ehLibrary.isFavorite(ehGallery.value.gid);
  return row.label === "角色" && library.isFavoriteCharacter(tag.name);
}
</script>

<template>
  <div
    class="page"
    :class="{ active: navigation.activePage === 'page-detail', 'home-detail-stable': stableDetailPages, 'home-detail-entering': detailTransitionDirection === 'enter' }"
    id="page-detail"
  >
    <div class="detail">
      <div v-if="work || ehGallery" class="detail-layout">
        <div class="detail-left">
          <div ref="coverElement" class="detail-cover" id="detailCover" :class="{ 'home-detail-cover-hidden': !!detailTransitionSource && coverFlightVisible }">
            <img ref="coverImage"
              v-if="displayCoverUrl"
              :src="displayCoverUrl"
              style="width: 100%; height: 100%; object-fit: cover"
              @error="imageError"
            />
            <template v-else>&#127916;</template>
          </div>
          <div class="detail-actions">
            <button
              class="btn-secondary"
              id="btnOpenFolder"
              @click="library.openWorkFolder(displayFolderPath)"
            >
              &#128451; 打开文件夹
            </button>
          </div>
        </div>
        <div class="detail-right">
          <div class="detail-main">
            <div class="detail-title" id="detailTitle">{{ displayTitle }}</div>
            <div class="detail-tags" id="detailTags">
              <div
                v-for="row in detailRows"
                :key="row.label"
                class="detail-tag-row"
                :class="{ jumpable: Boolean(row.filter || row.ehFilter) }"
              >
                <span class="detail-section-title">{{ row.label }}</span>
                <button
                  v-for="tag in row.tags"
                  :key="`${row.label}-${tag.name}`"
                  class="detail-tag"
                  :class="{
                    clickable: Boolean(row.filter || row.ehFilter),
                    favoritable: isFavoritable(row),
                    favorite: isFavoriteTag(row, tag),
                  }"
                  :title="tagTitle(row, tag)"
                  :aria-pressed="
                    isFavoritable(row)
                      ? isFavoriteTag(row, tag)
                      : undefined
                  "
                  @click="handleTagClick(row, tag)"
                >
                  <span
                    v-if="
                      isFavoriteTag(row, tag)
                    "
                    class="favorite-character-star fluent-icon"
                    >&#xE735;</span
                  >{{ tag.name }}
                </button>
              </div>
            </div>
            <div v-if="!isEhDetail" class="detail-desc" id="detailDesc">
              <p
                v-for="(paragraph, index) in synopsis"
                :key="index"
                class="detail-desc-paragraph"
              >
                <template v-if="paragraph.length"
                  ><template
                    v-for="(chunk, chunkIndex) in paragraph"
                    :key="chunkIndex"
                    ><strong v-if="chunk.strong">{{ chunk.text }}</strong
                    ><template v-else>{{ chunk.text }}</template></template
                  ></template
                >
                <br v-else />
              </p>
            </div>
          </div>
          <div v-if="isEhDetail" class="detail-episodes eh-read-panel">
            <div class="episodes-title">阅读</div>
            <div class="eh-read-entry">
              <span class="fluent-icon">&#xE82D;</span>
              <div>
                <strong>{{ ehGallery?.pages || 0 }} 页</strong
                ><small>从第一页开始阅读</small>
              </div>
              <button
                class="btn-primary"
                @click="ehGallery && ehReader.open(ehGallery)"
              >
                开始阅读
              </button>
            </div>
          </div>
          <div v-else class="detail-episodes">
            <div class="episodes-title">集数列表</div>
            <div class="episode-list" id="episodeList">
              <button
                v-for="(episode, index) in episodes"
                :key="episode.id"
                class="episode-item"
                :data-episode-id="episode.id"
                @click="playerCommands.openPlayer(episode.id)"
              >
                <span class="episode-cover">
                  <img
                    v-if="library.coverUrl(episode.cover_path)"
                    :src="library.coverUrl(episode.cover_path)"
                    style="
                      width: 100%;
                      height: 100%;
                      object-fit: cover;
                      position: absolute;
                      top: 0;
                      left: 0;
                    "
                    @error="imageError"
                  />
                  &#127916;
                </span>
                <span class="episode-info"
                  ><span class="episode-num"
                    >第
                    {{
                      String(Number(episode.number) || index + 1).padStart(
                        2,
                        "0",
                      )
                    }}
                    集</span
                  ><span class="episode-sub">{{ episode.title }}</span></span
                >
                <span class="episode-play">&#9654; 播放</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.eh-read-panel {
  min-height: 138px;
}
.eh-read-entry {
  min-height: 82px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--subtle-bg);
  padding: 14px 16px;
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
}
.eh-read-entry > .fluent-icon {
  font-size: 25px;
  color: var(--primary);
}
.eh-read-entry > div {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.eh-read-entry strong {
  font-size: 13px;
  color: var(--text-strong);
}
.eh-read-entry small {
  font-size: 10px;
  color: var(--muted);
}
.eh-read-entry button {
  height: 34px;
  padding: 0 18px;
}
</style>
