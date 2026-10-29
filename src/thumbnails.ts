import type { TreeType } from './trees';

/** Lightweight inline-SVG icons for the tree selector (zero asset requests). */
export function thumbSvg(type: TreeType): string {
  const common = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"';
  switch (type) {
    case 'oak':
      return `<svg ${common}>
        <rect x="29" y="40" width="6" height="18" rx="2" fill="#6b4423"/>
        <circle cx="32" cy="26" r="15" fill="#3fbf6f"/>
        <circle cx="21" cy="32" r="10" fill="#36a862"/>
        <circle cx="43" cy="32" r="10" fill="#36a862"/>
      </svg>`;
    case 'pine':
      return `<svg ${common}>
        <rect x="29" y="48" width="6" height="12" rx="2" fill="#7a5230"/>
        <polygon points="32,6 46,28 18,28" fill="#2f9e5b"/>
        <polygon points="32,20 50,42 14,42" fill="#2a8e52"/>
        <polygon points="32,34 54,54 10,54" fill="#25804a"/>
      </svg>`;
    case 'palm':
      return `<svg ${common}>
        <path d="M30 24 Q31 42 28 60 L36 60 Q33 42 34 24 Z" fill="#7a5230"/>
        <g fill="#59c47a">
          <path d="M32 22 Q12 14 6 24 Q22 20 32 26 Z"/>
          <path d="M32 22 Q52 14 58 24 Q42 20 32 26 Z"/>
          <path d="M32 22 Q16 6 10 10 Q26 14 32 26 Z"/>
          <path d="M32 22 Q48 6 54 10 Q38 14 32 26 Z"/>
          <path d="M32 22 Q30 4 32 2 Q34 4 32 22 Z"/>
        </g>
        <circle cx="32" cy="23" r="3" fill="#b5651d"/>
      </svg>`;
  }
}
