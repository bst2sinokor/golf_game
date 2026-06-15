'use client'
import { useEffect, useState } from 'react'

/**
 * 메신저 인앱브라우저(카카오톡/네이버/인스타/페북/라인 등) 안에서 열렸을 때
 * - Android: 외부 브라우저로 자동 이동 시도 (카카오 전용 스킴 → 크롬 intent)
 * - iOS: 자동 강제가 막혀 있어 안내 배너만 표시 (사용자가 직접 '다른 브라우저로 열기')
 *
 * 인앱브라우저 결정은 메신저 앱 레벨에서 일어나므로, 페이지가 인앱에서
 * 일단 로드된 뒤 JS로 감지해 우회하는 방식이다.
 */

type Env = { isInApp: boolean; isAndroid: boolean; isIOS: boolean; app: string }

function detect(ua: string): Env {
  const isAndroid = /android/i.test(ua)
  const isIOS = /iphone|ipad|ipod/i.test(ua)
  // 인앱브라우저 UA 토큰 (소문자 비교)
  const u = ua.toLowerCase()
  let app = ''
  if (u.includes('kakaotalk')) app = 'kakao'
  else if (u.includes('naver(inapp') || u.includes('naver ')) app = 'naver'
  else if (u.includes('instagram')) app = 'instagram'
  else if (u.includes('fban') || u.includes('fbav') || u.includes('fb_iab')) app = 'facebook'
  else if (/\bline\//i.test(ua)) app = 'line'
  else if (u.includes('daumapps')) app = 'daum'
  else if (u.includes('whale')) app = '' // 웨일은 정식 브라우저 → 제외
  else if (u.includes('; wv)') || u.includes('inapp')) app = 'generic' // 기타 WebView

  return { isInApp: app !== '', isAndroid, isIOS, app }
}

const APP_NAME: Record<string, string> = {
  kakao: '카카오톡', naver: '네이버 앱', instagram: '인스타그램',
  facebook: '페이스북', line: '라인', daum: '다음 앱', generic: '메신저 앱',
}

export default function InAppBrowserGuard() {
  const [showGuide, setShowGuide] = useState(false)
  const [env, setEnv] = useState<Env | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (typeof navigator === 'undefined') return
    const e = detect(navigator.userAgent || '')
    if (!e.isInApp) return
    setEnv(e)

    // 자동 이동은 세션당 1회만 시도 (루프 방지)
    const tried = sessionStorage.getItem('inapp_escape_tried')

    if (e.isAndroid && !tried) {
      sessionStorage.setItem('inapp_escape_tried', '1')
      const full = window.location.href
      if (e.app === 'kakao') {
        // 카카오톡 전용: 외부 브라우저로 강제
        window.location.href =
          'kakaotalk://web/openExternal?url=' + encodeURIComponent(full)
      } else {
        // 기타 안드로이드 인앱 → 크롬 intent (미설치 시 원본 URL로 폴백)
        const noScheme = full.replace(/^https?:\/\//, '')
        window.location.href =
          'intent://' + noScheme +
          '#Intent;scheme=https;package=com.android.chrome;' +
          'S.browser_fallback_url=' + encodeURIComponent(full) + ';end'
      }
      // 스킴이 실패할 수 있으니 안내 배너도 함께 노출 (폴백)
      setTimeout(() => setShowGuide(true), 1500)
      return
    }

    // iOS 및 자동 시도 이후 → 안내 배너
    setShowGuide(true)
  }, [])

  if (!showGuide || !env) return null

  const appLabel = APP_NAME[env.app] || '인앱 브라우저'
  const guide = env.isIOS
    ? `${appLabel}에서는 자동 전환이 막혀 있어요.\n우측 ${env.app === 'kakao' ? '하단' : '상단'}의 메뉴(⋯ 또는 공유) → ‘다른 브라우저로 열기’ / ‘Safari로 열기’를 눌러 주세요.`
    : `자동 전환이 안 되면, 우측 상단 메뉴(⋮)에서 ‘다른 브라우저로 열기’를 눌러 주세요.`

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(15,23,42,.62)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
    }}>
      <div style={{
        background: '#fff', borderRadius: 18, width: '100%', maxWidth: 380,
        overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,.32)',
      }}>
        <div style={{ padding: '18px 20px 14px', background: 'linear-gradient(135deg, #166534, #16a34a)' }}>
          <p style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: 0 }}>외부 브라우저로 열어 주세요</p>
          <p style={{ fontSize: 12.5, color: '#d1fae5', margin: '4px 0 0' }}>
            {appLabel} 안에서는 점수 저장·새로고침이 불안정할 수 있어요.
          </p>
        </div>
        <div style={{ padding: '16px 20px 18px' }}>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: '#0f172a', margin: 0, whiteSpace: 'pre-line' }}>
            {guide}
          </p>
          <div style={{
            marginTop: 14, padding: '10px 12px', background: '#f1f5f9', borderRadius: 10,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{
              flex: 1, fontSize: 12, color: '#475569', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{typeof window !== 'undefined' ? window.location.href : ''}</span>
            <button onClick={copyUrl} style={{
              flexShrink: 0, padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: copied ? '#16a34a' : '#2563eb', color: '#fff', fontSize: 12.5, fontWeight: 700,
            }}>{copied ? '복사됨 ✓' : '주소 복사'}</button>
          </div>
          <button onClick={() => setShowGuide(false)} style={{
            marginTop: 12, width: '100%', padding: '11px 0', borderRadius: 10, border: '1px solid #e2e8f0',
            cursor: 'pointer', background: '#fff', color: '#64748b', fontSize: 13.5, fontWeight: 700,
          }}>이대로 계속 보기</button>
        </div>
      </div>
    </div>
  )
}
