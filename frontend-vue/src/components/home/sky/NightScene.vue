<script setup lang="ts">
defineProps<{ prefix: string }>();
</script>

<!-- 保留用户提供的天空图标路径及分层，只把静态定位与动画作用域隔开。 -->
<template>
  <svg class="sky-scene" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient :id="prefix + '-night-sky'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1A1F4D"/><stop offset="1" stop-color="#4A3E8C"/></linearGradient>
            <radialGradient :id="prefix + '-night-glow'"><stop offset="0" stop-color="#FFE9A6"/><stop offset="1" stop-color="#FFE9A6" stop-opacity="0"/></radialGradient>
            <clipPath :id="prefix + '-night-clip'"><circle cx="48" cy="48" r="46"/></clipPath>
            <mask :id="prefix + '-night-moon'"><rect width="96" height="96" fill="#fff"/><circle cx="57" cy="42" r="15" fill="#000"/></mask>
          </defs>
          <g :clip-path="'url(#' + prefix + '-night-clip)'">
            <rect width="96" height="96" :fill="'url(#' + prefix + '-night-sky)'"/>
            <g fill="#fff">
              <circle class="sky-o sky-tw" cx="20" cy="22" r="1.3" style="--d:2.8s;--l:-.3s"/>
              <circle class="sky-o sky-tw" cx="58" cy="20" r="1.1" style="--d:3.4s;--l:-1.5s"/>
              <circle class="sky-o sky-tw" cx="83" cy="48" r="1.4" style="--d:2.4s;--l:-.9s"/>
              <circle class="sky-o sky-tw" cx="70" cy="74" r="1.1" style="--d:3.8s;--l:-2.2s"/>
              <circle class="sky-o sky-tw" cx="18" cy="66" r="1.2" style="--d:3s;--l:-1.1s"/>
              <g transform="translate(76 24)"><path class="sky-o sky-tw" d="M0-3.2L.9-.9L3.2 0L.9.9L0 3.2L-.9.9L-3.2 0L-.9-.9Z" style="--d:3.2s;--l:-.6s"/></g>
              <g transform="translate(24 40)"><path class="sky-o sky-tw" d="M0-2.4L.7-.7L2.4 0L.7.7L0 2.4L-.7.7L-2.4 0L-.7-.7Z" style="--d:4s;--l:-2s"/></g>
            </g>
            <g class="sky-o sky-float" style="--d:6s">
              <circle class="sky-o sky-glow" cx="46" cy="48" r="28" :fill="'url(#' + prefix + '-night-glow)'" style="--o1:.3;--o2:.55"/>
              <circle cx="46" cy="48" r="18" fill="#FFE9A6" :mask="'url(#' + prefix + '-night-moon)'"/>
              <path d="M33 50q2.5 2.5 5 0" fill="none" stroke="#8A6B2E" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M35 58q1.8 1.6 3.6 0" fill="none" stroke="#8A6B2E" stroke-width="1.4" stroke-linecap="round"/>
              <circle cx="34" cy="54.5" r="2.2" fill="#FF9AA2" opacity=".6"/>
            </g>
            <g transform="translate(50 68) scale(1.1)"><g class="sky-o sky-drift" style="--d:14s" fill="#8B84D6" opacity=".55"><ellipse cx="14" cy="9" rx="13" ry="4.5"/><circle cx="10" cy="6.5" r="4.5"/><circle cx="17.5" cy="5" r="5.5"/></g></g>
          </g>
          <circle class="sky-ring" cx="48" cy="48" r="46"/>
        </svg>
</template>
