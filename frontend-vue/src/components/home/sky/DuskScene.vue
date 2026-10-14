<script setup lang="ts">
defineProps<{ prefix: string }>();
</script>

<!-- 保留用户提供的天空图标路径及分层，只把静态定位与动画作用域隔开。 -->
<template>
  <svg class="sky-scene" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient :id="prefix + '-dusk-sky'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5E55C2"/><stop offset=".55" stop-color="#EE86A6"/><stop offset="1" stop-color="#FFC078"/></linearGradient>
            <linearGradient :id="prefix + '-dusk-sea'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7A5FB8"/><stop offset="1" stop-color="#352A72"/></linearGradient>
            <radialGradient :id="prefix + '-dusk-glow'"><stop offset="0" stop-color="#FFD08A"/><stop offset="1" stop-color="#FFD08A" stop-opacity="0"/></radialGradient>
            <clipPath :id="prefix + '-dusk-clip'"><circle cx="48" cy="48" r="46"/></clipPath>
          </defs>
          <g :clip-path="'url(#' + prefix + '-dusk-clip)'">
            <rect width="96" height="96" :fill="'url(#' + prefix + '-dusk-sky)'"/>
            <g class="sky-o sky-drift" style="--d:13s"><ellipse cx="22" cy="26" rx="14" ry="2.6" fill="#F7A9C4" opacity=".7"/><ellipse cx="72" cy="38" rx="12" ry="2.2" fill="#FFC9A0" opacity=".7"/></g>
            <g transform="translate(48 62)"><g class="sky-o sky-sink">
              <circle class="sky-o sky-glow" r="22" :fill="'url(#' + prefix + '-dusk-glow)'"/>
              <circle r="13" fill="#FFE08A"/>
            </g></g>
            <rect y="64" width="96" height="32" :fill="'url(#' + prefix + '-dusk-sea)'"/>
            <g stroke="#FFD79A" stroke-width="1.6" stroke-linecap="round">
              <path class="sky-o sky-shimmer" d="M38 68h20" style="--l:0s"/><path class="sky-o sky-shimmer" d="M41 72h14" style="--l:-.6s"/><path class="sky-o sky-shimmer" d="M43 76h10" style="--l:-1.2s"/><path class="sky-o sky-shimmer" d="M45 80h6" style="--l:-1.8s"/>
            </g>
            <g transform="translate(0 22)"><path class="sky-o sky-fly" d="M0 0q2.5-3 5 0q2.5-3 5 0" fill="none" stroke="#4A3A86" stroke-width="1.4" stroke-linecap="round" style="--d:15s;--l:-3s"/></g>
            <g transform="translate(0 32) scale(.8)"><path class="sky-o sky-fly" d="M0 0q2.5-3 5 0q2.5-3 5 0" fill="none" stroke="#4A3A86" stroke-width="1.4" stroke-linecap="round" style="--d:18s;--l:-9s"/></g>
          </g>
          <circle class="sky-ring" cx="48" cy="48" r="46"/>
        </svg>
</template>
