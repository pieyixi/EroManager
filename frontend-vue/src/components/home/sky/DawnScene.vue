<script setup lang="ts">
defineProps<{ prefix: string }>();
</script>

<!-- 保留用户提供的天空图标路径及分层，只把静态定位与动画作用域隔开。 -->
<template>
  <svg class="sky-scene" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient :id="prefix + '-dawn-sky'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F7B3B0"/><stop offset=".55" stop-color="#FFD7A8"/><stop offset="1" stop-color="#FFF1C9"/></linearGradient>
            <radialGradient :id="prefix + '-dawn-glow'"><stop offset="0" stop-color="#FFD27A"/><stop offset="1" stop-color="#FFD27A" stop-opacity="0"/></radialGradient>
            <clipPath :id="prefix + '-dawn-clip'"><circle cx="48" cy="48" r="46"/></clipPath>
          </defs>
          <g :clip-path="'url(#' + prefix + '-dawn-clip)'">
            <rect width="96" height="96" :fill="'url(#' + prefix + '-dawn-sky)'"/>
            <g transform="translate(58 20) scale(.9)"><g class="sky-o sky-drift" style="--d:10s" fill="#fff" opacity=".85"><ellipse cx="14" cy="9" rx="13" ry="4.5"/><circle cx="10" cy="6.5" r="4.5"/><circle cx="17.5" cy="5" r="5.5"/></g></g>
            <g transform="translate(48 62)"><g class="sky-o sky-rise">
              <circle class="sky-o sky-glow" r="24" :fill="'url(#' + prefix + '-dawn-glow)'"/>
              <g class="sky-o sky-spin" style="--d:30s" stroke="#FFC25C" stroke-width="2.6" stroke-linecap="round">
                <path d="M0-19V-24"/><path d="M0-19V-24" transform="rotate(45)"/><path d="M0-19V-24" transform="rotate(90)"/><path d="M0-19V-24" transform="rotate(135)"/><path d="M0-19V-24" transform="rotate(180)"/><path d="M0-19V-24" transform="rotate(225)"/><path d="M0-19V-24" transform="rotate(270)"/><path d="M0-19V-24" transform="rotate(315)"/>
              </g>
              <circle r="14" fill="#FFB347"/>
            </g></g>
            <path d="M0 66C18 56 34 60 48 66C62 72 80 56 96 62V96H0Z" fill="#F4A38C"/>
            <path d="M0 78C20 70 36 76 52 78C70 80 84 72 96 74V96H0Z" fill="#E88A78"/>
          </g>
          <circle class="sky-ring" cx="48" cy="48" r="46"/>
        </svg>
</template>
