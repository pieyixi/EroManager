<script setup lang="ts">
defineProps<{ prefix: string }>();
</script>

<!-- 保留用户提供的天空图标路径及分层，只把静态定位与动画作用域隔开。 -->
<template>
  <svg class="sky-scene" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient :id="prefix + '-noon-sky'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4FB0FF"/><stop offset="1" stop-color="#B8E3FF"/></linearGradient>
            <radialGradient :id="prefix + '-noon-glow'"><stop offset="0" stop-color="#FFF1A0"/><stop offset="1" stop-color="#FFF1A0" stop-opacity="0"/></radialGradient>
            <clipPath :id="prefix + '-noon-clip'"><circle cx="48" cy="48" r="46"/></clipPath>
          </defs>
          <g :clip-path="'url(#' + prefix + '-noon-clip)'">
            <rect width="96" height="96" :fill="'url(#' + prefix + '-noon-sky)'"/>
            <g transform="translate(48 44)">
              <circle class="sky-o sky-glow" r="28" :fill="'url(#' + prefix + '-noon-glow)'"/>
              <g class="sky-o sky-spin" style="--d:36s" stroke="#FFC933" stroke-width="2.6" stroke-linecap="round">
                <path d="M0-19.5V-26"/><path d="M0-19.5V-26" transform="rotate(30)"/><path d="M0-19.5V-26" transform="rotate(60)"/><path d="M0-19.5V-26" transform="rotate(90)"/><path d="M0-19.5V-26" transform="rotate(120)"/><path d="M0-19.5V-26" transform="rotate(150)"/><path d="M0-19.5V-26" transform="rotate(180)"/><path d="M0-19.5V-26" transform="rotate(210)"/><path d="M0-19.5V-26" transform="rotate(240)"/><path d="M0-19.5V-26" transform="rotate(270)"/><path d="M0-19.5V-26" transform="rotate(300)"/><path d="M0-19.5V-26" transform="rotate(330)"/>
              </g>
              <circle r="15" fill="#FFD83B"/>
              <path d="M-8-2h6M2-2h6" fill="none" stroke="#7A4A1E" stroke-width="1.8" stroke-linecap="round"/>
              <ellipse class="sky-o sky-yawn" cy="6" rx="3" ry="3.4" fill="#8C3A2B"/>
              <circle cx="-10" cy="3" r="2.6" fill="#FF8F8F" opacity=".5"/><circle cx="10" cy="3" r="2.6" fill="#FF8F8F" opacity=".5"/>
            </g>
            <g transform="translate(10 68)"><g class="sky-o sky-drift" style="--d:11s" fill="#fff" opacity=".9"><ellipse cx="14" cy="9" rx="13" ry="4.5"/><circle cx="10" cy="6.5" r="4.5"/><circle cx="17.5" cy="5" r="5.5"/></g></g>
          </g>
          <circle class="sky-ring" cx="48" cy="48" r="46"/>
        </svg>
</template>
