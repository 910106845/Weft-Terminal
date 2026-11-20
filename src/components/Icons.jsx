export default function Icon({ name, size = 15, className = '' }) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
    'aria-hidden': true
  }

  switch (name) {
    case 'refresh':
      return (
        <svg {...props}>
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
      )
    case 'save':
      return (
        <svg {...props}>
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <path d="M17 21v-8H7v8" />
          <path d="M7 3v5h8" />
        </svg>
      )
    case 'apple':
      return (
        <svg {...props} fill="currentColor" stroke="none">
          <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
        </svg>
      )
    case 'windows':
      return (
        <svg {...props} fill="currentColor" stroke="none">
          <path d="M3 5.4 10.3 4.3v7.2H3zM11.3 4.1 21 2.7v8.8h-9.7zM3 12.5h7.3v7.2L3 18.6zM11.3 12.5H21v8.8l-9.7-1.4z" />
        </svg>
      )
    case 'copy':
      return (
        <svg {...props}>
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
        </svg>
      )
    case 'trash':
      return (
        <svg {...props}>
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
      )
    case 'plug':
      return (
        <svg {...props}>
          <path d="M9 2v6" />
          <path d="M15 2v6" />
          <path d="M6 8h12v3a6 6 0 0 1-12 0V8z" />
          <path d="M12 17v5" />
        </svg>
      )
    case 'power':
      return (
        <svg {...props}>
          <path d="M18.36 6.64a9 9 0 1 1-12.72 0" />
          <path d="M12 2v10" />
        </svg>
      )
    case 'cpu':
      return (
        <svg {...props}>
          <rect x="7" y="7" width="10" height="10" rx="2" />
          <path d="M9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4" />
        </svg>
      )
    case 'memory':
      return (
        <svg {...props}>
          <rect x="3" y="8" width="18" height="9" rx="2" />
          <path d="M7 8v9M11 8v9M15 8v9M19 8v9M6 5v3M10 5v3M14 5v3M18 5v3" />
        </svg>
      )
    case 'disk':
      return (
        <svg {...props}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 12h11" />
          <circle cx="17" cy="12" r="1.5" />
        </svg>
      )
    case 'network':
      return (
        <svg {...props}>
          <path d="M7 20V4M7 4 3 8M7 4l4 4" />
          <path d="M17 4v16M17 20l-4-4M17 20l4-4" />
        </svg>
      )
    case 'signal':
      return (
        <svg {...props}>
          <path d="M4 20v-4M9.5 20v-7M15 20V9M20.5 20V5" />
        </svg>
      )
    case 'clock':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      )
    case 'folder':
      return (
        <svg {...props}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      )
    case 'file':
      return (
        <svg {...props}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
      )
    case 'server':
      return (
        <svg {...props}>
          <rect x="3" y="3" width="18" height="7" rx="2" />
          <rect x="3" y="14" width="18" height="7" rx="2" />
          <path d="M7 6.5h.01" />
          <path d="M7 17.5h.01" />
          <path d="M11 6.5h6" />
          <path d="M11 17.5h6" />
        </svg>
      )
    case 'download':
      return (
        <svg {...props}>
          <path d="M12 3v12" />
          <path d="M7 10l5 5 5-5" />
          <path d="M4 21h16" />
        </svg>
      )
    case 'upload':
      return (
        <svg {...props}>
          <path d="M12 16V4" />
          <path d="M7 9l5-5 5 5" />
          <path d="M4 21h16" />
        </svg>
      )
    case 'grip':
      return (
        <svg {...props}>
          <g fill="currentColor" stroke="none">
            <circle cx="9" cy="6" r="1.25" />
            <circle cx="15" cy="6" r="1.25" />
            <circle cx="9" cy="12" r="1.25" />
            <circle cx="15" cy="12" r="1.25" />
            <circle cx="9" cy="18" r="1.25" />
            <circle cx="15" cy="18" r="1.25" />
          </g>
        </svg>
      )
    case 'format':
      return (
        <svg {...props}>
          <path d="M4 6h16" />
          <path d="M4 12h10" />
          <path d="M4 18h7" />
          <path d="M17 14l4 4-4 4" />
        </svg>
      )
    case 'chevron-down':
      return (
        <svg {...props}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      )
    case 'close':
      return (
        <svg {...props}>
          <path d="M6 6l12 12" />
          <path d="M18 6L6 18" />
        </svg>
      )
    case 'plus':
      return (
        <svg {...props}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      )
    case 'send':
      return (
        <svg {...props}>
          <path d="M22 2L11 13" />
          <path d="M22 2l-7 20-4-9-9-4z" />
        </svg>
      )
    case 'stop':
      return (
        <svg {...props}>
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      )
    case 'history':
      return (
        <svg {...props}>
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l3 2" />
        </svg>
      )
    case 'terminal':
      return (
        <svg {...props}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M7 9l3 3-3 3" />
          <path d="M13 15h4" />
        </svg>
      )
    case 'sun':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="M4.93 4.93l1.42 1.42" />
          <path d="M17.66 17.66l1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="M4.93 19.07l1.42-1.42" />
          <path d="M17.66 6.34l1.41-1.41" />
        </svg>
      )
    case 'moon':
      return (
        <svg {...props}>
          <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z" />
        </svg>
      )
    case 'search':
      return (
        <svg {...props}>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      )
    case 'edit':
      return (
        <svg {...props}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
      )
    case 'play':
      return (
        <svg {...props}>
          <path d="M8 5v14l11-7z" />
        </svg>
      )
    case 'pause':
      return (
        <svg {...props}>
          <rect x="7" y="5" width="3.5" height="14" rx="1" />
          <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
        </svg>
      )
    case 'arrow-down':
      return (
        <svg {...props}>
          <path d="M12 4v16" />
          <path d="M6 14l6 6 6-6" />
        </svg>
      )
    case 'bolt':
      return (
        <svg {...props}>
          <path d="M13 2L4.5 13H11l-1 9L19.5 11H13z" />
        </svg>
      )
    case 'command':
      return (
        <svg {...props}>
          <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" />
        </svg>
      )
    case 'star':
      return (
        <svg {...props}>
          <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.2 1 5.9L12 17l-5.2 2.8 1-5.9-4.3-4.2 5.9-.9z" />
        </svg>
      )
    case 'move-top':
      return (
        <svg {...props}>
          <path d="M5 4h14" />
          <path d="M12 20V8" />
          <path d="M7 13l5-5 5 5" />
        </svg>
      )
    case 'alert':
      return (
        <svg {...props}>
          <path d="M10.3 3.9L2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          <path d="M12 9v5" />
          <path d="M12 17h.01" />
        </svg>
      )
    case 'broom':
      return (
        <svg {...props}>
          <path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z" />
          <path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7" />
          <path d="M14.5 17.5 4.5 15" />
        </svg>
      )
    case 'unplug':
      return (
        <svg {...props}>
          <path d="m19 5 3-3" />
          <path d="m2 22 3-3" />
          <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
          <path d="M7.5 13.5 10 11" />
          <path d="M10.5 16.5 13 14" />
          <path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z" />
        </svg>
      )
    case 'link':
      return (
        <svg {...props}>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      )
    case 'tab-plus':
      return (
        <svg {...props}>
          <path d="M4 8a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" />
          <path d="M12 11v6M9 14h6" />
        </svg>
      )
    case 'home':
      return (
        <svg {...props}>
          <path d="M4 10.5 12 4l8 6.5" />
          <path d="M6 9.5V20h12V9.5" />
          <path d="M10 20v-5h4v5" />
        </svg>
      )
    case 'arrow-left':
      return (
        <svg {...props}>
          <path d="M20 12H5" />
          <path d="M11 18l-6-6 6-6" />
        </svg>
      )
    case 'arrow-right':
      return (
        <svg {...props}>
          <path d="M4 12h15" />
          <path d="M13 6l6 6-6 6" />
        </svg>
      )
    case 'close-all':
      return (
        <svg {...props}>
          <rect x="8" y="8" width="12" height="12" rx="2" />
          <path d="M4 16V6a2 2 0 0 1 2-2h10" />
          <path d="M12 12l4 4M16 12l-4 4" />
        </svg>
      )
    case 'window-plus':
      return (
        <svg {...props}>
          <rect x="3" y="4" width="13" height="13" rx="2" />
          <path d="M18 13v8" />
          <path d="M14 17h8" />
        </svg>
      )
    case 'list':
      return (
        <svg {...props}>
          <path d="M4 6h.01M4 12h.01M4 18h.01" strokeWidth={2.6} />
          <path d="M9 6h11M9 12h11M9 18h11" />
        </svg>
      )
    case 'more':
      return (
        <svg {...props}>
          <g fill="currentColor" stroke="none">
            <circle cx="5" cy="12" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="19" cy="12" r="1.5" />
          </g>
        </svg>
      )
    case 'wave':
      return (
        <svg {...props}>
          <path d="M2 12h3l2.5-7 4 14L15 8l2 4h5" />
        </svg>
      )
    case 'panel-bottom':
      return (
        <svg {...props}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 15h18" />
        </svg>
      )
    case 'panel-left':
      return (
        <svg {...props}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
        </svg>
      )
    case 'check':
      return (
        <svg {...props}>
          <path d="M5 12l4.5 4.5L19 7" />
        </svg>
      )
    default:
      return null
  }
}
