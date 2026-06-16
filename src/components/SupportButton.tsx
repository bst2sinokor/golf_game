'use client'
import { useState } from 'react'
import { DONATION, DONATION_ENABLED } from '@/lib/donation'

/**
 * 광고 없이 서비스를 유지하기 위한 후원(커피 한 잔) 진입점.
 * - variant 'link'  : 첫 화면 푸터용 (작은 텍스트 링크)
 * - variant 'button': 결과 화면용 (버튼)
 * 링크는 src/lib/donation.ts 에서 관리. 인앱브라우저 외부 전환은 layout의 가드가 처리.
 */

// 직접 그린 커피 컵 아이콘 (이모지 대신)
function CoffeeIcon({ size = 18, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ flexShrink: 0 }}>
      {/* 김 */}
      <path d="M9 2.4c-.8 1-.8 2.1 0 3.1M12.5 2.4c-.8 1-.8 2.1 0 3.1"
        stroke={color} strokeWidth="1.4" strokeLinecap="round" opacity=".65" />
      {/* 컵 */}
      <path d="M4.5 8h11v5.3A4.7 4.7 0 0 1 10.8 18H9.2A4.7 4.7 0 0 1 4.5 13.3V8Z" fill={color} />
      {/* 손잡이 */}
      <path d="M15.5 9.4h2.3a2.4 2.4 0 0 1 0 4.8h-2.3"
        stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      {/* 받침 */}
      <path d="M3.5 20.6h13" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export default function SupportButton({ variant = 'link' }: { variant?: 'link' | 'button' }) {
  const [open, setOpen] = useState(false)
  if (!DONATION_ENABLED) return null

  const trigger =
    variant === 'button' ? (
      <button onClick={() => setOpen(true)} className="btn" style={{
        background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa',
        marginBottom: 8, fontWeight: 700,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      }}>
        <CoffeeIcon size={18} color="#c2410c" />
        졸고 있는 개발자 응원하기
      </button>
    ) : (
      <button onClick={() => setOpen(true)} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'var(--muted)', fontSize: 17, fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', gap: 8, padding: 4,
        textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: 'var(--border)',
      }}>
        <CoffeeIcon size={20} color="var(--muted)" />
        졸고 있는 개발자 응원하기
      </button>
    )

  return (
    <>
      {trigger}
      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(15,23,42,.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 18, width: '100%', maxWidth: 360,
            overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,.3)',
          }}>
            <div style={{ padding: '20px 20px 16px', background: 'linear-gradient(135deg, #166534, #16a34a)', position: 'relative' }}>
              <button onClick={() => setOpen(false)} style={{
                position: 'absolute', top: 12, right: 12, width: 28, height: 28, borderRadius: '50%',
                border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,.22)', color: '#fff',
                fontSize: 15, fontWeight: 800, lineHeight: 1,
              }}>✕</button>
              <div style={{
                width: 44, height: 44, borderRadius: 14, background: 'rgba(255,255,255,.18)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12,
              }}>
                <CoffeeIcon size={26} color="#fff" />
              </div>
              <p style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: 0 }}>광고 있는 앱이 싫어서 직접 만들었어요</p>
              <p style={{ fontSize: 12.5, color: '#d1fae5', margin: '5px 0 0', lineHeight: 1.55 }}>
                밤새 커피로 버티며 만들었어요.<br />마음에 드셨다면 응원해 주세요!
              </p>
            </div>
            <div style={{ padding: '16px 20px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {DONATION.kakaopay && (
                <a href={DONATION.kakaopay} target="_blank" rel="noopener noreferrer" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '13px 0', borderRadius: 12, textDecoration: 'none',
                  background: '#ffeb00', color: '#3c1e1e', fontSize: 15, fontWeight: 700,
                }}>카카오페이로 응원하기</a>
              )}
              {DONATION.naverpay && (
                <a href={DONATION.naverpay} target="_blank" rel="noopener noreferrer" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '13px 0', borderRadius: 12, textDecoration: 'none',
                  background: '#03c75a', color: '#fff', fontSize: 15, fontWeight: 700,
                }}>네이버페이로 응원하기</a>
              )}
              <p style={{ fontSize: 11.5, color: 'var(--muted)', textAlign: 'center', margin: '4px 0 0', lineHeight: 1.5 }}>
                졸리지만 18홀까지 신속하고 정확하게 정산해 드릴게요!
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
