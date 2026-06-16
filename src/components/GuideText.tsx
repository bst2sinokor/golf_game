'use client'
import type { GameType } from '@/lib/types'

// 게임별 강조 색 (플레이 화면 태그 색과 동일 계열)
export const GAME_COLOR: Record<GameType, string> = {
  stroke: '#16a34a',
  lasvegas: '#d97706',
  'team-match': '#2563eb',
  jootanwootan: '#7c3aed',
  hussein: '#dc2626',
  scratch: '#0891b2',
  jopok: '#db2777',
  sinperio: '#64748b',
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩'

// 설명 텍스트(【】 헤더 · [n] 단계 · ①② 하위 · • 불릿 · 들여쓰기 예시)를 디자인 요소로 렌더링
export default function GuideText({ text, accent }: { text: string; accent: string }) {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  let introDone = false

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '')
    const trimmed = line.trim()
    if (trimmed === '') { nodes.push(<div key={i} style={{ height: 6 }} />); return }

    // 【섹션 헤더】
    const mHead = trimmed.match(/^【(.+)】$/)
    if (mHead) {
      nodes.push(
        <div key={i} style={{
          display: 'inline-block', margin: '12px 0 6px', padding: '3px 11px', borderRadius: 7,
          background: accent + '1f', color: accent, fontSize: 13, fontWeight: 800, letterSpacing: '.2px',
        }}>{mHead[1]}</div>
      )
      return
    }

    // [n] 단계
    const mStep = trimmed.match(/^\[(\d+)\]\s*(.+)$/)
    if (mStep) {
      nodes.push(
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '14px 0 7px' }}>
          <span style={{
            flexShrink: 0, width: 24, height: 24, borderRadius: '50%', background: accent, color: '#fff',
            fontSize: 13, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{mStep[1]}</span>
          <span style={{ fontSize: 15, fontWeight: 800 }}>{mStep[2]}</span>
        </div>
      )
      return
    }

    // ①②③④ 하위 단계
    if (CIRCLED.includes(trimmed[0])) {
      const rest = trimmed.slice(1).trim().replace(/^—\s*/, '')
      nodes.push(
        <div key={i} style={{ display: 'flex', gap: 7, margin: '7px 0 2px', alignItems: 'baseline' }}>
          <span style={{ flexShrink: 0, color: accent, fontWeight: 800, fontSize: 14 }}>{trimmed[0]}</span>
          <span style={{ fontSize: 13, lineHeight: 1.55 }}>{rest}</span>
        </div>
      )
      return
    }

    // • 불릿 (' / ' 포함 시 칩으로)
    if (trimmed.startsWith('•')) {
      const body = trimmed.slice(1).trim()
      if (body.includes(' / ')) {
        nodes.push(
          <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '3px 0 3px 4px' }}>
            {body.split(' / ').map((c, k) => (
              <span key={k} style={{
                padding: '3px 9px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                background: accent + '14', color: accent, border: `1px solid ${accent}33`,
              }}>{c.trim()}</span>
            ))}
          </div>
        )
        return
      }
      nodes.push(
        <div key={i} style={{ display: 'flex', gap: 8, margin: '3px 0', alignItems: 'baseline' }}>
          <span style={{ flexShrink: 0, width: 5, height: 5, borderRadius: '50%', background: accent, transform: 'translateY(-2px)' }} />
          <span style={{ fontSize: 13, lineHeight: 1.6, flex: 1, minWidth: 0 }}>{body}</span>
        </div>
      )
      return
    }

    // 들여쓰기 — 예시/보조설명 콜아웃
    if (/^\s/.test(line)) {
      const c = trimmed.replace(/^-\s*/, '')
      const isExample = trimmed.startsWith('예)') || /^\s*예\)/.test(line)
      nodes.push(
        <div key={i} style={{
          margin: '2px 0 2px 16px', padding: '4px 10px', borderRadius: 6,
          background: isExample ? '#fffbeb' : '#f8fafc',
          borderLeft: `3px solid ${isExample ? '#f59e0b' : 'var(--border)'}`,
          fontSize: 12, lineHeight: 1.55, color: 'var(--muted)',
        }}>{c}</div>
      )
      return
    }

    // 그 외 — 첫 줄은 인트로 박스, 나머지는 일반 문단
    if (!introDone) {
      introDone = true
      nodes.push(
        <div key={i} style={{
          padding: '10px 12px', borderRadius: 10, background: accent + '12',
          borderLeft: `4px solid ${accent}`, fontSize: 13.5, fontWeight: 600, lineHeight: 1.6, color: 'var(--text)',
        }}>{trimmed}</div>
      )
      return
    }
    nodes.push(<p key={i} style={{ fontSize: 13, lineHeight: 1.6, margin: '4px 0' }}>{trimmed}</p>)
  })

  return <div>{nodes}</div>
}
