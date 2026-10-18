<script setup lang="ts">
defineProps<{ name: 'edit' | 'account' | 'switch' | 'lock' | 'logout' | 'chevron' | 'camera' | 'copy' | 'minus' | 'plus' }>();
</script>
<template>
  <svg class="profile-icon" :viewBox="['chevron','camera','copy','minus','plus'].includes(name) ? '0 0 16 16' : '0 0 24 24'" aria-hidden="true" fill="none" stroke="currentColor" :stroke-width="['camera','copy'].includes(name) ? 1.5 : 1.6" stroke-linecap="round" stroke-linejoin="round">
    <template v-if="name === 'edit'"><path d="m4 16.4-.7 4.3 4.3-.7L20.1 7.5a2.1 2.1 0 0 0 0-3l-.6-.6a2.1 2.1 0 0 0-3 0Z"/><path d="m15.1 5.3 3.6 3.6M14.5 21h6.8"/></template>
    <template v-else-if="name === 'account'"><circle cx="12" cy="8" r="3.6"/><path d="M7 21c.3-3 1.9-4.5 5-4.5s4.7 1.5 5 4.5M5 15.3a8 8 0 1 1 14 0l-1 1.7M5 15.3l1 1.7"/></template>
    <template v-else-if="name === 'switch'"><path d="M4 8h16l-4-4M20 16H4l4 4"/></template>
    <template v-else-if="name === 'lock'"><rect x="5" y="10" width="14" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></template>
    <template v-else-if="name === 'logout'"><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M10 12h11m-4-4 4 4-4 4"/></template>
    <template v-else-if="name === 'camera'"><path d="M2 5.5h2.5L6 3.5h4l1.5 2H14v7H2Z"/><circle cx="8" cy="9" r="2.2"/></template>
    <template v-else-if="name === 'copy'"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 3.5v-.2A1.3 1.3 0 0 0 9.2 2H3.8A1.8 1.8 0 0 0 2 3.8v5.4a1.3 1.3 0 0 0 1.3 1.3h.2"/></template>
    <path v-else-if="name === 'minus'" d="M3.5 8h9"/>
    <path v-else-if="name === 'plus'" d="M3.5 8h9M8 3.5v9"/>
    <path v-else d="m6 3 5 5-5 5"/>
  </svg>
</template>
