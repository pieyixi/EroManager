<script setup lang="ts">
import AppDialog from '../shared/AppDialog.vue';
import { cancelClose, closeState, confirmClose } from '../../features/shell/closeController';
</script>
<template>
  <AppDialog :open="closeState.visible" :allow-while-suspended="true" title="点击关闭按钮以后" width="360px" @close="cancelClose">
    <div class="close-application-options">
      <label><input v-model="closeState.selected" type="radio" value="tray" name="close-dialog-action" :disabled="closeState.busy">最小化到系统托盘</label>
      <label><input v-model="closeState.selected" type="radio" value="exit" name="close-dialog-action" :disabled="closeState.busy">退出应用</label>
      <label class="close-no-ask"><input v-model="closeState.noAsk" type="checkbox" :disabled="closeState.busy">不再提示</label>
      <p v-if="closeState.error" class="close-application-error" role="alert">{{ closeState.error }}</p>
      <div class="close-application-actions"><button class="btn-secondary" :disabled="closeState.busy" @click="cancelClose">取消</button><button class="btn-primary" :disabled="closeState.busy" @click="confirmClose">{{ closeState.busy ? '正在处理' : '确定' }}</button></div>
    </div>
  </AppDialog>
</template>
<style scoped>
.close-application-options{padding:5px 7px 0}.close-application-options label{display:flex;align-items:center;gap:9px;margin:0 0 12px;font-size:13px;color:var(--text-secondary);cursor:pointer}.close-application-options input{width:15px;height:15px;accent-color:var(--primary)}.close-application-options .close-no-ask{margin:26px 0}.close-application-actions{display:flex;gap:10px}.close-application-actions button{flex:1;height:32px;min-height:32px;padding:0;border-radius:5px;font-size:12px}.close-application-error{font-size:12px;line-height:1.7;color:var(--danger);overflow-wrap:anywhere;margin-bottom:12px}
</style>
