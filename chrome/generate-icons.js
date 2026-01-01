const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];

const svgTemplate = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <rect x="10" y="15" width="108" height="85" rx="15" fill="url(#grad1)"/>
  <path d="M 35 100 L 25 115 L 45 105 Z" fill="url(#grad1)"/>
  <text x="64" y="50" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="white" text-anchor="middle">GIF</text>
  <path d="M 40 70 L 88 70 L 88 65 L 98 75 L 88 85 L 88 80 L 40 80 Z" fill="white" opacity="0.9"/>
  <circle cx="100" cy="25" r="12" fill="#FEE500"/>
  <ellipse cx="100" cy="24" rx="8" ry="6" fill="#3C1E1E"/>
</svg>`;

console.log('아이콘 생성을 시작합니다...');
console.log('\n브라우저에서 수동으로 생성하는 방법:');
console.log('1. icons/generate-icons.html 파일을 브라우저에서 열기');
console.log('2. 자동으로 icon16.png, icon48.png, icon128.png 다운로드됨');
console.log('3. 다운로드된 파일을 icons/ 폴더로 이동');

console.log('\n또는 온라인 도구 사용:');
console.log('1. https://www.aconvert.com/image/svg-to-png/ 방문');
console.log('2. icons/icon.svg 업로드');
console.log('3. 16x16, 48x48, 128x128 크기로 각각 변환');
console.log('4. icon16.png, icon48.png, icon128.png로 저장');
