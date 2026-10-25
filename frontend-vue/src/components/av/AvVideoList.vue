<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AvWork } from '../../api/contracts/av';
import { accountScope } from '../../api/accountContext';
import { useAvLibraryStore } from '../../stores/avLibrary';
import { useNavigationStore } from '../../stores/navigation';
import { avPlayerEpisodes } from '../../features/player/avPlayback';
import { playerCommands } from '../../features/player/commands';
import CoverImage from '../shared/CoverImage.vue';
const props = defineProps<{ work: AvWork }>();
const library = useAvLibraryStore(), navigation = useNavigationStore();
const opening = ref(false);
const videos = computed(() => avPlayerEpisodes(props.work));
async function play(id: number): Promise<void> {
  if (opening.value) return;
  const owner = accountScope(), code = props.work.code;
  opening.value = true;
  try {
    await library.refreshVideos(code);
    if (owner !== accountScope() || code !== props.work.code || navigation.activePage !== 'page-detail') return;
    const episode = avPlayerEpisodes(library.currentWork).find(episode => episode.id === id);
    if (episode) await playerCommands.openPlayerWithEpisode(episode, `${code} ${props.work.title} / ${episode.title}`, 'av');
  } finally { opening.value = false; }
}
</script>
<template>
  <section v-if="videos.length" class="detail-episodes av-video-panel">
    <div class="episodes-title">视频</div>
    <div class="episode-list">
      <button v-for="video in videos" :key="video.id" class="episode-item" :data-video-kind="video.id === 2 ? 'cut' : 'original'" :disabled="opening" @click="play(video.id)">
        <span class="episode-cover"><CoverImage :src="library.imageUrl(work.cover)" :alt="video.title || ''" :jacket="work.cover_layout !== 'portrait'" /></span>
        <span class="episode-info"><span class="episode-num">{{ video.title }}</span><span class="episode-sub">{{ video.subtitle }}</span></span>
        <span class="episode-play">&#9654; 播放</span>
      </button>
    </div>
  </section>
</template>
