'use client'
import { useState } from 'react'
import { DONATION, DONATION_ENABLED } from '@/lib/donation'

/**
 * 광고 없이 서비스를 유지하기 위한 '커피 한 잔 응원하기' 진입점.
 * - variant 'link'  : 첫 화면 푸터용 (작은 텍스트 링크)
 * - variant 'button': 결과 화면용 (버튼)
 * 링크는 src/lib/donation.ts 에서 관리. 인앱브라우저 외부 전환은 layout의 가드가 처리.
 */
export default function SupportButton({ variant = 'link' }: { variant?: 'link' | 'button' }) {
  const [open, setOpen] = useState(false)
  if (!DONATION_ENABLED) return null

  const trigger =
    variant === 'button' ? (
      <button onClick={() => setOpen(true)} className="btn" style={{
        background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa',
        marginBottom: 8, fontWeight: 700,
      }}>☕ 커피 한 잔 응원하기</button>
    ) : (
      <button onClick={() => setOpen(true)} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'var(--muted)', fontSize: 12.5, fontWeight: 600,
        textDecoration: 'underline', textUnderlineOffset: 3, padding: 4,
      }}>☕ 커피 한 잔으로 응원하기</button>
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
            <div style={{ padding: '18px 20px 14px', background: 'linear-gradient(135deg, #166534, #16a34a)', position: 'relative' }}>
              <button onClick={() => setOpen(false)} style={{
                position: 'absolute', top: 12, right: 12, width: 28, height: 28, borderRadius: '50%',
                border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,.22)', color: '#fff',
                fontSize: 15, fontWeight: 800, lineHeight: 1,
              }}>✕</button>
              <p style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: 0 }}>응원해 주셔서 고마워요</p>
              <p style={{ fontSize: 12.5, color: '#d1fae5', margin: '4px 0 0' }}>
                광고 없이 계속 운영할 수 있게 도와주세요. 커피 한 잔이면 충분해요 ☕
              </p>
            </div>
            <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                원하는 금액만큼 가볍게 보내실 수 있어요. 후원은 전적으로 선택이에요 🙂
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
