<script setup lang="ts">
defineProps<{ prefix: string }>();
</script>

<!-- 保留用户提供的天空图标路径及分层，只把静态定位与动画作用域隔开。 -->
<template>
  <svg class="sky-scene" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient :id="prefix + '-late-sky'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#080C26"/><stop offset="1" stop-color="#1B2760"/></linearGradient>
            <clipPath :id="prefix + '-late-clip'"><circle cx="48" cy="48" r="46"/></clipPath>
          </defs>
          <g :clip-path="'url(#' + prefix + '-late-clip)'">
            <rect width="96" height="96" :fill="'url(#' + prefix + '-late-sky)'"/>
            <g fill="#fff">
              <circle class="sky-o sky-tw" cx="18" cy="30" r="1.1" style="--d:2.6s;--l:-.4s"/>
              <circle class="sky-o sky-tw" cx="28" cy="16" r="1.4" style="--d:3.2s;--l:-1.2s"/>
              <circle class="sky-o sky-tw" cx="40" cy="26" r=".9" style="--d:4.1s;--l:-2.5s"/>
              <circle class="sky-o sky-tw" cx="52" cy="12" r="1.2" style="--d:2.9s;--l:-.8s"/>
              <circle class="sky-o sky-tw" cx="64" cy="22" r="1.6" style="--d:3.6s;--l:-1.9s"/>
              <circle class="sky-o sky-tw" cx="76" cy="14" r="1" style="--d:2.4s;--l:-2.1s"/>
              <circle class="sky-o sky-tw" cx="84" cy="32" r="1.2" style="--d:3.9s;--l:-.2s"/>
              <circle class="sky-o sky-tw" cx="70" cy="42" r=".9" style="--d:3.1s;--l:-1.6s"/>
              <circle class="sky-o sky-tw" cx="56" cy="36" r="1.1" style="--d:4.3s;--l:-3s"/>
              <circle class="sky-o sky-tw" cx="34" cy="46" r="1.3" style="--d:2.7s;--l:-.6s"/>
              <circle class="sky-o sky-tw" cx="20" cy="54" r="1" style="--d:3.5s;--l:-2.7s"/>
              <circle class="sky-o sky-tw" cx="46" cy="54" r=".9" style="--d:4s;--l:-1s"/>
              <circle class="sky-o sky-tw" cx="80" cy="58" r="1.4" style="--d:2.8s;--l:-1.4s"/>
              <circle class="sky-o sky-tw" cx="12" cy="42" r=".8" style="--d:3.3s;--l:-2.3s"/>
              <g transform="translate(24 22)"><path class="sky-o sky-tw" d="M0-3.2L.9-.9L3.2 0L.9.9L0 3.2L-.9.9L-3.2 0L-.9-.9Z" style="--d:3.4s;--l:-.9s"/></g>
              <g transform="translate(72 30)"><path class="sky-o sky-tw" d="M0-2.6L.8-.8L2.6 0L.8.8L0 2.6L-.8.8L-2.6 0L-.8-.8Z" style="--d:4.2s;--l:-2.6s"/></g>
              <g class="sky-o sky-shoot"><path d="M0 0L13-6.5V-5Z" opacity=".8"/><circle r="1.6"/></g>
            </g>
            <path d="M0 82L14 74L26 80L40 70L54 79L68 72L82 80L96 74V96H0Z" fill="#060921"/>
          </g>
          <circle class="sky-ring" cx="48" cy="48" r="46"/>
        </svg>
</template>
