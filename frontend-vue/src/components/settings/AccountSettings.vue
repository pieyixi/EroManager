<script setup lang="ts">
import SettingRow from './SettingRow.vue';
import SettingsSelect from './SettingsSelect.vue';
import PasswordSetting from './PasswordSetting.vue';
import { idleLockSeconds, backgroundLockSeconds } from '../../api/contracts/accounts';
import { useAccountsStore } from '../../stores/accounts';
import { useHomeStore } from '../../stores/home';

const accounts = useAccountsStore(), home = useHomeStore();
const idleOptions = idleLockSeconds.map(value => ({ value, label: value ? `${value / 60} 分钟` : '关闭' }));
const backgroundOptions = backgroundLockSeconds.map(value => ({ value, label: value === 0 ? '关闭' : value === 1 ? '立即' : `${value / 60} 分钟` }));
</script>
<template>
  <div class="settings-card account-settings">
    <PasswordSetting />
    <SettingRow title="闲置自动锁定"><SettingsSelect label="闲置自动锁定" :model-value="accounts.privacy.idle_seconds" :options="idleOptions" @change="value => accounts.savePrivacy({ idle_seconds: Number(value) })" /></SettingRow>
    <SettingRow title="切到后台锁定"><SettingsSelect label="切到后台锁定" :model-value="accounts.privacy.background_seconds" :options="backgroundOptions" @change="value => accounts.savePrivacy({ background_seconds: Number(value) })" /></SettingRow>
    <SettingRow title="最小化时锁定"><input type="checkbox" class="setting-switch" aria-label="最小化时锁定" :checked="accounts.privacy.minimize" @change="accounts.savePrivacy({ minimize: ($event.target as HTMLInputElement).checked })"></SettingRow>
    <SettingRow title="锁屏或休眠后锁定"><input type="checkbox" class="setting-switch" aria-label="锁屏或休眠后锁定" :checked="accounts.privacy.system" @change="accounts.savePrivacy({ system: ($event.target as HTMLInputElement).checked })"></SettingRow>
    <SettingRow title="播放期间允许闲置锁定"><input type="checkbox" class="setting-switch" aria-label="播放期间允许闲置锁定" :checked="accounts.privacy.while_playing" @change="accounts.savePrivacy({ while_playing: ($event.target as HTMLInputElement).checked })"></SettingRow>
    <p v-if="accounts.privacyError || home.persistenceError" role="alert" class="account-setting-error">{{ accounts.privacyError || home.persistenceError }}</p>
  </div>
</template>
<style scoped>
.account-setting-error{color:#ed566b;font-size:12px}
</style>
