<script setup lang="ts">
defineProps<{ prefix: string }>();
</script>

<!-- 保留用户提供的天空图标路径及分层，只把静态定位与动画作用域隔开。 -->
<template>
  <svg class="sky-scene" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient :id="prefix + '-afternoon-sky'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFC58A"/><stop offset="1" stop-color="#FFEFD2"/></linearGradient>
            <radialGradient :id="prefix + '-afternoon-glow'"><stop offset="0" stop-color="#FFCB78"/><stop offset="1" stop-color="#FFCB78" stop-opacity="0"/></radialGradient>
            <clipPath :id="prefix + '-afternoon-clip'"><circle cx="48" cy="48" r="46"/></clipPath>
          </defs>
          <g :clip-path="'url(#' + prefix + '-afternoon-clip)'">
            <rect width="96" height="96" :fill="'url(#' + prefix + '-afternoon-sky)'"/>
            <g transform="translate(8 20) scale(.9)"><g class="sky-o sky-drift" style="--d:12s" fill="#fff" opacity=".7"><ellipse cx="14" cy="9" rx="13" ry="4.5"/><circle cx="10" cy="6.5" r="4.5"/><circle cx="17.5" cy="5" r="5.5"/></g></g>
            <g transform="translate(62 32)"><g class="sky-o sky-sway">
              <circle class="sky-o sky-glow" r="22" :fill="'url(#' + prefix + '-afternoon-glow)'"/>
              <g class="sky-o sky-spin" style="--d:40s" stroke="#FFA531" stroke-width="2.6" stroke-linecap="round">
                <path d="M0-17V-22"/><path d="M0-17V-22" transform="rotate(45)"/><path d="M0-17V-22" transform="rotate(90)"/><path d="M0-17V-22" transform="rotate(135)"/><path d="M0-17V-22" transform="rotate(180)"/><path d="M0-17V-22" transform="rotate(225)"/><path d="M0-17V-22" transform="rotate(270)"/><path d="M0-17V-22" transform="rotate(315)"/>
              </g>
              <circle r="13" fill="#FFB03B"/>
              <path d="M-6-1q2.2-3 4.4 0M1.6-1q2.2-3 4.4 0" fill="none" stroke="#7A4A1E" stroke-width="1.6" stroke-linecap="round"/>
              <path d="M-3.5 3.5Q0 6.5 3.5 3.5" fill="none" stroke="#7A4A1E" stroke-width="1.5" stroke-linecap="round"/>
              <circle cx="-8.5" cy="3.5" r="2.4" fill="#FF7E6B" opacity=".5"/><circle cx="8.5" cy="3.5" r="2.4" fill="#FF7E6B" opacity=".5"/>
            </g></g>
            <g transform="translate(22 62)">
              <g fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round">
                <g transform="translate(4 0)"><path class="sky-o sky-steam" d="M0-4q-3-4 0-8q3-4 0-8" style="--l:0s"/></g>
                <g transform="translate(10 0)"><path class="sky-o sky-steam" d="M0-4q3-4 0-8q-3-4 0-8" style="--l:-1.1s"/></g>
                <g transform="translate(16 0)"><path class="sky-o sky-steam" d="M0-4q-3-4 0-8q3-4 0-8" style="--l:-2.2s"/></g>
              </g>
              <ellipse cx="10" cy="17.5" rx="14" ry="2.2" fill="#fff" opacity=".7"/>
              <path d="M20 3h2.5a4 4 0 0 1 0 8H19.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
              <path d="M0 0H20V8a8 8 0 0 1-8 8H8a8 8 0 0 1-8-8Z" fill="#fff"/>
              <ellipse cx="10" cy=".8" rx="10" ry="2" fill="#C98A5B"/>
            </g>
          </g>
          <circle class="sky-ring" cx="48" cy="48" r="46"/>
        </svg>
</template>
