<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useProfileStore } from '../../stores/profile';
import { useNavigationStore } from '../../stores/navigation';
import ProfileIcon from './ProfileIcon.vue';
import ProfileEditor from './ProfileEditor.vue';
import { useProfileExpansion } from '../../features/settings/useProfileExpansion';
import '../../assets/styles/profile.css';
import { beginAccountSwitch, lockAccount, logoutAccount } from '../../features/accounts/controller';

const props = defineProps<{ flow: HTMLElement | null }>();
const profile = useProfileStore(), navigation = useNavigationStore();
const root = ref<HTMLElement | null>(null), trigger = ref<HTMLButtonElement | null>(null);
const switchItem = ref<HTMLButtonElement | null>(null), lockItem = ref<HTMLButtonElement | null>(null), logoutItem = ref<HTMLButtonElement | null>(null);
const menuOpen = ref(false), editorOpen = ref(false);
const avatarButton = ref<HTMLElement | null>(null), visual = ref<HTMLElement | null>(null);
const summary = ref<HTMLElement | null>(null), divider = ref<HTMLElement | null>(null);
const { expanded, animating, phase, setExpanded, reset } = useProfileExpansion({ avatar: avatarButton, visual, summary, divider, flow: () => props.flow });
function dismiss(): void { menuOpen.value = false; }
function outside(event: Event): void { if (!root.value?.contains(event.target as Node)) dismiss(); }
async function toggleMenu(): Promise<void> { menuOpen.value = !menuOpen.value; if (menuOpen.value) { await nextTick(); switchItem.value?.focus(); } }
function keydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); trigger.value?.focus(); }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const items = [switchItem.value, lockItem.value, logoutItem.value];
    const index = items.indexOf(event.target as HTMLButtonElement);
    items[event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowDown' ? 1 : -1) + 3) % 3]?.focus();
  }
  if (event.key === 'Tab') dismiss();
}
function edit(): void { dismiss(); editorOpen.value = true; }
function preview(): void { dismiss(); void setExpanded(!expanded.value); }
function escape(event: KeyboardEvent): void {
  if (event.key === 'Escape' && expanded.value && !event.defaultPrevented && !editorOpen.value && !menuOpen.value) {
    event.preventDefault(); void setExpanded(false);
  }
}
document.addEventListener('keydown', escape);
function menuAction(action: 'switch' | 'lock' | 'logout'): void {
  dismiss(); reset();
  if (action === 'lock') void lockAccount();
  else if (action === 'logout') void logoutAccount();
  else void beginAccountSwitch();
}
watch(menuOpen, open => {
  if (open) { document.addEventListener('pointerdown', outside, true); document.addEventListener('scroll', dismiss, true); }
  else { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', dismiss, true); }
});
watch(() => navigation.activePage, page => { if (page !== 'page-settings') { dismiss(); editorOpen.value = false; reset(); } });
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', dismiss, true); document.removeEventListener('keydown', escape); });
</script>
<template>
  <div class="settings-profile settings-profile-expandable" :class="{ 'is-avatar-expanded': expanded, 'is-avatar-animating': animating }" :data-avatar-phase="phase" aria-label="账号资料">
    <button ref="avatarButton" class="settings-avatar profile-avatar-button" :aria-label="expanded ? '收起头像' : '查看头像'" :aria-expanded="expanded" @click="preview"><span ref="visual" class="profile-avatar-visual"><img v-if="profile.avatar" :src="profile.avatar" alt="账号头像"><template v-else>裏</template></span></button>
    <div ref="summary" class="profile-summary">
      <div class="profile-name"><strong :title="profile.nickname">{{ profile.nickname }}</strong><button class="profile-edit" aria-label="编辑账号" @click="edit"><ProfileIcon name="edit" /></button></div>
      <div ref="root" class="profile-account-control">
        <button ref="trigger" class="profile-account-trigger" aria-haspopup="menu" :aria-expanded="menuOpen" @click="toggleMenu" @keydown.down.prevent="toggleMenu"><ProfileIcon name="account" />切换或退出账号</button>
        <Transition name="settings-select-menu"><div v-if="menuOpen" class="profile-account-menu" role="menu" aria-label="账号操作" @keydown="keydown">
          <button ref="switchItem" role="menuitem" @click="menuAction('switch')"><ProfileIcon name="switch" />切换账号</button>
          <button ref="lockItem" role="menuitem" title="Ctrl + Shift + L" aria-keyshortcuts="Control+Shift+L" @click="menuAction('lock')"><ProfileIcon name="lock" />立即锁定</button>
          <button ref="logoutItem" class="profile-logout" role="menuitem" @click="menuAction('logout')"><ProfileIcon name="logout" />退出登录</button>
        </div></Transition>
      </div>
    </div>
    <ProfileEditor :open="editorOpen" @close="editorOpen = false" />
    <div ref="divider" class="profile-divider" aria-hidden="true"></div>
  </div>
</template>
