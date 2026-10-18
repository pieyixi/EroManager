<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import AppDialog from '../shared/AppDialog.vue';
import ProfileIcon from './ProfileIcon.vue';
import AvatarCropDialog from './AvatarCropDialog.vue';
import { useProfileStore } from '../../stores/profile';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const profile = useProfileStore();
const picker = ref<HTMLInputElement | null>(null), nameInput = ref<HTMLInputElement | null>(null);
const nameEditing = ref(false), nameDraft = ref(''), nameError = ref('');
const selectedFile = ref<File | null>(null);
const copyTip = ref('');
let copyTimer: ReturnType<typeof setTimeout> | undefined, copyVersion = 0;
function clearCopy(): void { copyVersion++; clearTimeout(copyTimer); copyTip.value = ''; }
async function copyId(): Promise<void> {
  const request = ++copyVersion; clearTimeout(copyTimer);
  try { await navigator.clipboard.writeText(profile.id); if (props.open && request === copyVersion) copyTip.value = '已复制'; }
  catch { if (props.open && request === copyVersion) copyTip.value = '复制失败'; }
  if (props.open && request === copyVersion) copyTimer = setTimeout(() => { copyTip.value = ''; }, 1400);
}
function chooseFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  selectedFile.value = input.files?.[0] ?? null;
  input.value = '';
}
async function editName(): Promise<void> { nameDraft.value = profile.nickname; nameError.value = ''; nameEditing.value = true; await nextTick(); nameInput.value?.focus(); nameInput.value?.select(); }
async function saveName(): Promise<void> {
  if (!nameEditing.value) return;
  if (!nameDraft.value.trim()) { nameError.value = '请输入昵称'; return; }
  if (await profile.rename(nameDraft.value)) { nameEditing.value = false; nameError.value = ''; } else nameError.value = profile.error;
}
function blurName(): void { if (nameDraft.value.trim()) saveName(); else cancelName(); }
function cancelName(): void { nameEditing.value = false; nameError.value = ''; }
async function saveAvatar(avatar: string): Promise<void> { if (await profile.setAvatar(avatar)) selectedFile.value = null; }
watch(() => props.open, open => { if (!open) { cancelName(); clearCopy(); selectedFile.value = null; } });
onBeforeUnmount(clearCopy);
</script>
<template>
  <AppDialog :open="open" title="账号资料" width="400px" dialog-class="profile-dialog" @close="emit('close')">
    <p v-if="profile.error" role="alert" class="profile-inline-error">{{ profile.error }}</p>
    <div class="profile-details">
      <button class="profile-detail-row profile-avatar-row" @click="picker?.click()"><span>头像</span><span class="profile-detail-value"><span class="profile-editor-avatar"><img v-if="profile.avatar" :src="profile.avatar" alt="当前头像"><template v-else>裏</template><span class="profile-avatar-badge"><ProfileIcon name="camera" /></span></span><ProfileIcon name="chevron" /></span></button>
      <div v-if="nameEditing" class="profile-detail-row profile-nickname-row"><span>昵称</span><form class="profile-inline-name" @submit.prevent="saveName"><input ref="nameInput" v-model="nameDraft" class="profile-name-input" aria-label="昵称" maxlength="24" spellcheck="false" autocomplete="off" @blur="blurName" @keydown.esc.stop.prevent="cancelName"><span v-if="nameError" class="profile-inline-error" role="alert">{{ nameError }}</span></form></div>
      <button v-else class="profile-detail-row" @click="editName"><span>昵称</span><span class="profile-detail-value"><span class="profile-nickname-value" :title="profile.nickname">{{ profile.nickname }}</span><ProfileIcon name="chevron" /></span></button>
      <div class="profile-detail-row profile-id-row"><span>ID</span><span class="profile-id-value"><span class="profile-copy-tip" :class="{ 'is-error': copyTip === '复制失败' }" role="status">{{ copyTip }}</span><span class="profile-id">{{ profile.id }}</span><button class="profile-copy-button" aria-label="复制 ID" title="复制" @click="copyId"><ProfileIcon name="copy" /></button></span></div>
    </div>
    <input ref="picker" class="profile-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp" aria-label="选择本地头像" @change="chooseFile">
  </AppDialog>
  <AvatarCropDialog v-if="selectedFile && open" :file="selectedFile" @close="selectedFile = null" @confirm="saveAvatar" />
</template>
