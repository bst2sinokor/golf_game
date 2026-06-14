'use client'
import { useState, useRef, useEffect } from 'react'
import { GAME_LABELS, type GameType } from '@/lib/types'
import { GAME_DETAIL } from '@/lib/gameInfo'
import GuideText, { GAME_COLOR } from './GuideText'

const GAME_ORDER: GameType[] = ['stroke', 'lasvegas', 'team-match', 'jootanwootan', 'hussein', 'scratch', 'jopok', 'sinperio']

const HOST_GUIDE = `진행자는 '방을 만들고 게임을 정하는 사람'이에요. 보통 총무가 맡아요.

[1] 방 만들기
• 첫 화면에서 [방 만들기]를 누르고 내 이름을 적어요.
• 그러면 4자리 숫자(방 코드)가 만들어져요.
• 이 번호를 같이 치는 친구들에게 알려주면, 친구들이 폰으로 들어와요.

[2] 게임 정하기 (위쪽 탭을 차례로 눌러요)
① 코스설정 — 골프장·전반/후반 코스를 적고 [확정]. 홀마다 기준 타수(파)가 자동으로 채워져요.
② 기본설정 — 시작할 때 나눠줄 '기본 돈'과 규칙을 정해요. 잘 모르면 그대로 둬도 괜찮아요.
③ 게임선택 — 어떤 게임을, 몇 번 홀에서, 얼마에 할지 골라요. 이름 옆 (?)로 설명을 볼 수 있어요.
   (4명 미만이면 팀 게임 — 라스베가스·팀매치·좌탄우탄 — 은 선택할 수 없어요)
   ('조폭 스킨스'는 18홀 단독 게임이라 다른 메인 게임과는 함께 못 골라요(신페리오·니어·롱기와는 병행 가능). 진행 중 버디값은 미적용, 기본배분은 적용)
④ 금액설정 — 각자 낼 돈을 적고 [게임 시작]을 누르면 시작!

[3] 게임 중
• 점수표 칸을 누르면 그 사람·그 홀의 타수를 넣어요. (진행자는 모두 입력 가능)
• 한 홀의 전원이 점수를 다 넣으면 결과가 나와요 → [다음 홀]로 넘어가요.
• 홀을 넘기는 건 진행자만 할 수 있어요.

[4] 그 밖에
• 화면 위쪽: 왼쪽엔 방 코드, 오른쪽엔 돈(총납부금 ↔ 내 보유)을 눌러 바꿔 봐요.
• 게임 도중에도 ≡ 메뉴에서 사람 추가·순서 변경, 설정 변경이 가능해요.
• 실수로 이 설정 화면으로 돌아왔다면, 방 코드 옆 [방으로 돌아가기]를 눌러 진행 중인 게임으로 다시 들어가요. (이미 시작된 방에서만 보여요)
• 게임 도중에 새 사람이 들어와도 '기본 돈'은 받고, 들어온 다음 홀부터 정산에 포함돼요.

[5] 끝나면
• 18홀이 끝나면 '누가 누구에게 얼마를 주면 되는지' 정산 결과가 나와요.`

const PLAYER_GUIDE = `참여자는 '방 코드로 들어와 내 점수만 넣으면 되는 사람'이에요. 어렵지 않아요!

[1] 들어가기
• 첫 화면에서 [방 참가하기]를 눌러요.
• 진행자에게 받은 4자리 방 코드와 내 이름을 적어요.
• 진행자가 게임을 준비하는 동안 잠깐 기다려요. (화면에 'WAIT')

[2] 게임 중
• 게임이 시작되면(화면에 'LIVE') 내 점수만, 지금 치는 홀만 넣으면 돼요.
• '좌탄우탄' 게임이면 내 공이 왼쪽/오른쪽 어디로 갔는지 골라요.
• 홀을 넘기는 건 진행자가 해요. 진행자가 넘기면 자동으로 다음 홀 화면이 돼요.

[3] 내 돈 보기
• 화면 오른쪽 위에 '지금 내가 가진 돈'이 보여요.

[4] 알아두기
• 게임 도중에 들어와도 '기본 돈'은 받아요. 들어온 다음 홀부터 정산에 포함돼요.

[5] 끝나면
• 18홀이 끝나면 정산 결과를 함께 확인해요.`

const COMMON_GUIDE = `돈이 어떻게 늘고 주는지 쉽게 알려드릴게요.

【기본 돈 (기본금액 분배)】
• 게임 시작할 때 모두에게 똑같이 나눠주는 '시작 돈'이에요. 이 돈으로 내기를 시작해요.

【내가 가진 돈】
• 시작 돈에서 게임에 이기면 늘고, 지거나(버디값·벌금) 하면 줄어요.
• 화면 오른쪽 위에서 항상 확인할 수 있어요.

【비기면? (이월)】
• 어느 홀에서 비기면, 그 홀에 걸린 돈은 사라지지 않고 다음 홀로 넘어가요.
• 다음에 이긴 사람(팀)이 한꺼번에 가져가요.

【버디값】
• 누가 버디(기준보다 1타 적게) 이상을 치면, 못 친 사람들이 그 사람에게 정한 돈을 줘요.
• 같은 팀끼리는 안 주고받게 할 수도 있어요.

【OECD 벌금】
• 돈을 너무 많이 딴 사람은 'OECD'에 들어가요.
• 들어간 사람이 OB·벙커·쓰리퍼트 같은 실수를 하면 벌금을 내요. (많이 딴 사람 견제용 재미 규칙)
• 마지막 18번 홀은 벌금을 빼고 할 수도 있어요.

【니어리스트 / 롱기스트】
• 정해진 홀에서 핀에 가장 가깝게(니어) 또는 가장 멀리(롱기) 친 사람이 상금을 받아요.`

type Section = 'host' | 'player' | 'games' | 'common'

export default function HowToModal({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<Section>('host')
  const bodyRef = useRef<HTMLDivElement>(null)

  // 탭 전환 시 본문 스크롤을 맨 위로
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }) }, [section])

  const TABS: { v: Section; l: string }[] = [
    { v: 'host', l: '진행자' },
    { v: 'player', l: '참여자' },
    { v: 'games', l: '게임 룰' },
    { v: 'common', l: '공통 규칙' },
  ]

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(15,23,42,.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 18, width: '100%', maxWidth: 440,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 12px 40px rgba(0,0,0,.3)',
      }}>
        {/* 헤더 */}
        <div style={{
          padding: '16px 18px 14px', background: 'linear-gradient(135deg, #166534, #16a34a)', position: 'relative',
        }}>
          <button onClick={onClose} style={{
            position: 'absolute', top: 12, right: 12,
            width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,.22)', color: '#fff', fontSize: 15, fontWeight: 800, lineHeight: 1,
          }}>✕</button>
          <p style={{ fontSize: 19, fontWeight: 800, color: '#fff', margin: 0 }}>사용방법</p>
          <p style={{ fontSize: 12.5, color: '#d1fae5', margin: '3px 0 0' }}>처음이어도 괜찮아요. 차근차근 따라 해 보세요!</p>
        </div>

        {/* 섹션 탭 */}
        <div style={{ display: 'flex', gap: 4, padding: '10px 12px', borderBottom: '1px solid var(--border)', background: '#fafafa' }}>
          {TABS.map(({ v, l }) => (
            <button key={v} onClick={() => setSection(v)} style={{
              flex: 1, padding: '8px 2px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
              border: '1px solid var(--border)',
              background: section === v ? 'var(--blue)' : '#fff',
              color: section === v ? '#fff' : 'var(--muted)',
              boxShadow: section === v ? '0 2px 6px rgba(37,99,235,.25)' : 'none',
            }}>{l}</button>
          ))}
        </div>

        {/* 본문 */}
        <div ref={bodyRef} style={{ padding: 16, overflowY: 'auto', color: 'var(--text)' }}>
          {section === 'host' && <GuideText text={HOST_GUIDE} accent="#16a34a" />}
          {section === 'player' && <GuideText text={PLAYER_GUIDE} accent="#2563eb" />}
          {section === 'common' && <GuideText text={COMMON_GUIDE} accent="#d97706" />}
          {section === 'games' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
                각 게임의 룰과, 이 앱에 적용된 규칙·선택 옵션이에요.
              </p>
              {GAME_ORDER.map(g => (
                <div key={g} style={{
                  border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden',
                  borderLeft: `5px solid ${GAME_COLOR[g]}`,
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
                    background: GAME_COLOR[g] + '12',
                  }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: 7, background: GAME_COLOR[g], color: '#fff',
                      fontSize: 12, fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>{GAME_LABELS[g][0]}</span>
                    <span style={{ fontSize: 15, fontWeight: 800, color: GAME_COLOR[g] }}>{GAME_LABELS[g]}</span>
                  </div>
                  <div style={{ padding: '8px 12px 12px' }}>
                    <GuideText text={GAME_DETAIL[g]} accent={GAME_COLOR[g]} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
