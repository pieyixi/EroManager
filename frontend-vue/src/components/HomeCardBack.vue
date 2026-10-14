<script setup lang="ts">
import dayBack from '../assets/home/card-back-day.png'
import nightBack from '../assets/home/card-back-night.png'
</script>

<template>
  <!-- 使用确认的原图与自带边框，随全局主题切换，不另建主题状态。 -->
  <span class="home-card-back-design" aria-hidden="true">
    <img class="home-card-back-art home-card-back-day" :src="dayBack" alt="" :draggable="false" />
    <img class="home-card-back-art home-card-back-night" :src="nightBack" alt="" :draggable="false" />
  </span>
</template>
