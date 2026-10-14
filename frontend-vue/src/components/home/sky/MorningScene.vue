<script setup lang="ts">
defineProps<{ prefix: string }>();
</script>

<!-- 保留用户提供的天空图标路径及分层，只把静态定位与动画作用域隔开。 -->
<template>
  <svg class="sky-scene" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient :id="prefix + '-morning-sky'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7CC4FF"/><stop offset="1" stop-color="#DDF2FF"/></linearGradient>
            <radialGradient :id="prefix + '-morning-glow'"><stop offset="0" stop-color="#FFF3A8"/><stop offset="1" stop-color="#FFF3A8" stop-opacity="0"/></radialGradient>
            <clipPath :id="prefix + '-morning-clip'"><circle cx="48" cy="48" r="46"/></clipPath>
          </defs>
          <g :clip-path="'url(#' + prefix + '-morning-clip)'">
            <rect width="96" height="96" :fill="'url(#' + prefix + '-morning-sky)'"/>
            <g transform="translate(36 36)"><g class="sky-o sky-float">
              <circle class="sky-o sky-glow" r="22" :fill="'url(#' + prefix + '-morning-glow)'"/>
              <g class="sky-o sky-spin" style="--d:24s" stroke="#FFC93C" stroke-width="2.6" stroke-linecap="round">
                <path d="M0-18V-24"/><path d="M0-18V-24" transform="rotate(45)"/><path d="M0-18V-24" transform="rotate(90)"/><path d="M0-18V-24" transform="rotate(135)"/><path d="M0-18V-24" transform="rotate(180)"/><path d="M0-18V-24" transform="rotate(225)"/><path d="M0-18V-24" transform="rotate(270)"/><path d="M0-18V-24" transform="rotate(315)"/>
              </g>
              <circle r="14" fill="#FFD54A"/>
              <circle class="sky-o sky-blink" cx="-5" cy="-2" r="1.7" fill="#7A4A1E"/><circle class="sky-o sky-blink" cx="5" cy="-2" r="1.7" fill="#7A4A1E"/>
              <path d="M-4.5 3.5Q0 8 4.5 3.5" fill="none" stroke="#7A4A1E" stroke-width="1.6" stroke-linecap="round"/>
              <circle cx="-9" cy="3.5" r="2.6" fill="#FF8F8F" opacity=".5"/><circle cx="9" cy="3.5" r="2.6" fill="#FF8F8F" opacity=".5"/>
            </g></g>
            <g transform="translate(46 54) scale(1.3)"><g class="sky-o sky-drift" style="--d:9s" fill="#fff" opacity=".95"><ellipse cx="14" cy="9" rx="13" ry="4.5"/><circle cx="10" cy="6.5" r="4.5"/><circle cx="17.5" cy="5" r="5.5"/></g></g>
            <g transform="translate(14 72) scale(.9)"><g class="sky-o sky-drift" style="--d:12s" fill="#fff" opacity=".7"><ellipse cx="14" cy="9" rx="13" ry="4.5"/><circle cx="10" cy="6.5" r="4.5"/><circle cx="17.5" cy="5" r="5.5"/></g></g>
          </g>
          <circle class="sky-ring" cx="48" cy="48" r="46"/>
        </svg>
</template>
