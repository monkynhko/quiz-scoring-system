// Neónový žeriav so vstupenkou na háku – „predaj vstupeniek vo výstavbe“. Štýl ako logo (magenta + žltá).
export function NeonCrane({ size = 220, swing = true }: { size?: number; swing?: boolean }) {
  return (
    <svg className={`neon-crane ${swing ? 'swing' : ''}`} width={size} height={size} viewBox="0 0 200 200" role="img" aria-label="Žeriav – vo výstavbe">
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {/* stožiar (priehradová konštrukcia) */}
        <g className="nc-pink" strokeWidth="3">
          <path d="M52 186 V44 M68 186 V44" />
          <path d="M52 186 L68 166 L52 146 L68 126 L52 106 L68 86 L52 66 L68 46" strokeWidth="2" />
          <path d="M40 186 H80" />
        </g>
        {/* kabína a vrchol */}
        <g className="nc-pink" strokeWidth="3">
          <rect x="48" y="30" width="24" height="14" rx="3" />
          <path d="M60 30 V12" />
        </g>
        {/* výložník a protivýložník */}
        <g className="nc-pink" strokeWidth="3">
          <path d="M20 36 H186" />
          <path d="M60 12 L20 36 M60 12 L186 36" strokeWidth="2" />
          <path d="M84 36 L96 46 L108 36 L120 46 L132 36 L144 46 L156 36 L168 46 L180 36 M90 46 H174" strokeWidth="1.6" />
        </g>
        {/* protiváha */}
        <rect className="nc-pink" x="22" y="38" width="20" height="14" rx="2" strokeWidth="3" />
        {/* blikajúce svetlo na vrchole */}
        <circle className="nc-yellow nc-blink" cx="60" cy="9" r="3" strokeWidth="3" />
        {/* lano + hák + vstupenka (hojdá sa) */}
        <g className="nc-load">
          <path className="nc-pink" d="M150 46 V112" strokeWidth="2" />
          <path className="nc-yellow" d="M150 112 v6 a5 5 0 1 1 -5 -5" strokeWidth="2.6" />
          <g className="nc-yellow" strokeWidth="2.6">
            <path d="M126 128 h48 v10 a5 5 0 0 0 0 10 v10 h-48 v-10 a5 5 0 0 0 0 -10 z" />
            <path d="M160 128 v30" strokeDasharray="3 4" strokeWidth="1.8" />
            <path d="M134 140 h18 M134 147 h12" strokeWidth="2" />
          </g>
        </g>
      </g>
    </svg>
  )
}
