<script setup lang="ts">
defineProps<{ prefix: string }>();
</script>

<!-- 保留用户提供的天空图标路径及分层，只把静态定位与动画作用域隔开。 -->
<template>
  <svg class="sky-scene" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient :id="prefix + '-pre-sky'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0F1640"/><stop offset=".6" stop-color="#2B3C78"/><stop offset="1" stop-color="#8A88C0"/></linearGradient>
            <clipPath :id="prefix + '-pre-clip'"><circle cx="48" cy="48" r="46"/></clipPath>
            <mask :id="prefix + '-pre-moon'"><rect x="-20" y="-20" width="40" height="40" fill="#fff"/><circle cx="6" cy="-5" r="10.5" fill="#000"/></mask>
          </defs>
          <g :clip-path="'url(#' + prefix + '-pre-clip)'">
            <rect width="96" height="96" :fill="'url(#' + prefix + '-pre-sky)'"/>
            <g fill="#fff" opacity=".8">
              <circle class="sky-o sky-tw" cx="20" cy="24" r="1.1" style="--d:4.4s;--l:-.5s"/>
              <circle class="sky-o sky-tw" cx="36" cy="14" r="1" style="--d:5s;--l:-2s"/>
              <circle class="sky-o sky-tw" cx="76" cy="22" r="1.2" style="--d:4.8s;--l:-1.3s"/>
              <circle class="sky-o sky-tw" cx="28" cy="44" r=".9" style="--d:5.4s;--l:-3s"/>
              <circle class="sky-o sky-tw" cx="84" cy="44" r=".9" style="--d:4.6s;--l:-.9s"/>
            </g>
            <ellipse cx="48" cy="84" rx="50" ry="14" fill="#FF9F8A" opacity=".18"/>
            <g transform="translate(64 54)"><g class="sky-o sky-moonset">
              <circle r="13" fill="#FFE9A6" :mask="'url(#' + prefix + '-pre-moon)'"/>
              <path d="M-9 2q2.2 2.2 4.4 0" fill="none" stroke="#8A6B2E" stroke-width="1.4" stroke-linecap="round"/>
              <circle cx="-8" cy="6.5" r="1.8" fill="#FF9AA2" opacity=".6"/>
            </g></g>
            <g fill="#DDE3FF" font-family="'Segoe UI',Arial,sans-serif" font-weight="700">
              <text class="sky-o sky-zz" x="44" y="44" font-size="6" style="--l:0s">z</text>
              <text class="sky-o sky-zz" x="44" y="44" font-size="8" style="--l:-1.4s">z</text>
              <text class="sky-o sky-zz" x="44" y="44" font-size="10" style="--l:-2.8s">z</text>
            </g>
            <path d="M0 76C16 68 30 74 44 72C60 70 74 64 96 72V96H0Z" fill="#0C1236"/>
          </g>
          <circle class="sky-ring" cx="48" cy="48" r="46"/>
        </svg>
</template>
