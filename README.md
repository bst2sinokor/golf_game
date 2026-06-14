# 모두의 골프게임 — 실시간 골프 내기 자동 정산

## 프로젝트 개요
골프 라운드 중 동반자들이 각자 폰으로 접속해 점수를 입력하면, 선택한 내기 게임들의 손익을 실시간으로 자동 계산해주는 웹앱. 진행자가 방을 만들고 숫자 4자리 방코드를 공유하면 참가자들이 합류한다.

- **프레임워크**: Next.js 14 (App Router) + TypeScript + Tailwind CSS v4
- **실시간 DB**: Firebase Firestore (`onSnapshot` 구독)
- **배포**: Vercel — https://golf-game-nine.vercel.app
- **저장소**: 모노레포(`UBUNTU_DEV`)에서 개발, 배포용 단독 저장소 https://github.com/bst2sinokor/golf_game 로 subtree push

---

## 프로젝트 구조

```
106-golf-game/
├── src/
│   ├── app/
│   │   ├── page.tsx               # 첫 화면 (방 만들기 / 방 참가하기 + 좌측 상단 [사용방법])
│   │   ├── layout.tsx             # 루트 레이아웃, viewport 설정
│   │   ├── globals.css            # 전역 스타일, 애니메이션 (livePulse, waitBlink)
│   │   ├── setup/[roomId]/        # 진행자 게임 설정 (코스→기본→게임선택→금액→시작)
│   │   ├── play/[roomId]/         # 메인 플레이 화면 (스코어보드, 점수 입력)
│   │   └── result/[roomId]/       # 최종 정산 결과
│   ├── components/
│   │   ├── GameSettings.tsx       # 게임 중 설정 변경 (플레이어 관리 포함)
│   │   └── HowToModal.tsx         # 사용방법 가이드 (진행자/참여자/게임 룰/공통 규칙)
│   └── lib/
│       ├── firebase.ts            # Firebase 초기화 (환경변수 기반)
│       ├── gameInfo.ts            # 게임별 상세 룰·옵션 설명 (GAME_DETAIL, (?) 팝업·사용방법 공용)
│       ├── roomStore.ts           # Firestore CRUD (방 생성/참가/구독/정리)
│       ├── gameLogic.ts           # 정산 계산 엔진 (calcAllResults)
│       └── types.ts               # 타입 정의 (Room, GameConfig, PlayerTotals 등)
├── .env.local                     # Firebase 키 (git 제외)
└── package.json
```

---

## 핵심 컴포넌트

### 1. 정산 엔진 (`lib/gameLogic.ts`)
`calcAllResults(room)`이 방 데이터 전체를 받아 홀별 결과·플레이어 손익·정산을 한 번에 계산한다.

**은행(총납부금) 모델**
```
내 보유(지갑) = 기본금액분배 + 게임 승리금 + 버디 손익 + 스크래치 손익 − OECD 페널티
```
- 참가자 납부금은 은행(총납부금)에 쌓이고, 게임 승리금은 은행→지갑으로 지급 (패자 지갑 불변)
- 버디값: 지갑↔지갑 이동. 버디 못한 사람이 버디한 사람 각각에게 지급, 같은 팀 제외 옵션, **잔액 한도 내에서만 지급** (지갑 마이너스 불가)
- 스크래치: 지갑↔지갑 쌍별 타수차 정산 (잔액 제한 없음, 마이너스 가능)
- OECD 페널티: 지갑→은행 회수, 잔액 초과 불가
- 진행자 헤더에 은행 잔액(총납부금 현황) 표시
- **중간 참여자**: 합류 후에도 기본금액 분배는 정상 지급. 각 홀의 정산·버디·OECD는 그 홀에 점수를 입력한 플레이어만 참여하므로, 합류 전 홀의 정산에는 포함되지 않음 (점수 미입력 플레이어가 0점 처리·버디 납부되던 문제 해결)

**지원 게임 (8종)**
| 게임 | 방식 |
|------|------|
| 스킨스 | 홀 최저타 승자가 홀당 설정금액(+이월)만 수령, 동점 이월 (내부 키는 stroke) |
| 라스베가스 | 직전 홀 순위로 1+4위 vs 2+3위 팀 (진행자 직접 지정 가능) |
| 팀 매치플레이 | 고정 팀(블루/그린), 팀 합산 타수 자동 판정, 무승부 이월. 스코어보드에 NUP/T 누적 표시 |
| 좌탄우탄 | 홀마다 티샷 방향(좌/우)으로 팀 구성. 한 방향 정원(전체 인원÷2 올림) 도달 시 해당 방향 버튼 마감 처리 |
| 후세인 | 직전 홀 2등 1명 vs 나머지. 후세인 점수는 비교 상대 인원수만큼 곱해 공정 비교, 승리 시 설정금액×상대수 독식, 패배 시 상대 전원에게 설정금액 지급. 점수 비교 방식 선택: 연합군 전원(본인×3 vs 3명 합) / 최하위 1명 제외(그 홀 최다타 연합군 1명 빼고 합산, 본인×남은 수 — 빠진 사람도 상금엔 동일 참여, 4인 이상에서만 선택 가능). 인원에 따라 배수 자동 조정 |
| 스크래치 | 쌍별 타수 차 × 타당 금액 직접 정산 |
| 조폭 스킨스 | 스킨스 + 벌칙/강탈. ① 보기·더블·트리플 시 누적 보유금을 토해냄(설정금액 단위 올림, 강도 옵션: 더블50·트리플+100 전홀 / 파3만 한 단계 엄격) ② 반납금은 그 홀 승자 독식 ③ 버디 시 나머지 전원 보유금 강탈. **18홀 단독 진행(다른 게임과 동시 선택 불가), 기본배분 적용·버디값 미적용**. 내부 키 jopok |
| 신페리오 | 정식 신페리오(New Peoria): 숨은 12홀(전반 6+후반 6, 파 합이 코스 파의 ~2/3가 되도록 대표 선정) 합×1.5 핸디캡, 18홀 종료 후 넷스코어 타수차 쌍별 정산 (지갑 무관, 결과 화면 별도 카드) |

**무승부 이월(carry)** — 무승부 시 그 홀에 걸린 총 상금이 이월되어 다음 승리 측에 얹어짐
- 같은 게임 연속: 상금 풀 누적 (팀게임은 팀 유지 설정에 따라 다음 홀 팀 구성 결정)
- 단체전 → 개인전(스킨스): 팀 상금 전체(팀매치 ×2, 후세인 ×3 등)를 개인 승자에게 몰빵
- 개인전 → 단체전 / 다른 단체전 진입: 이월금 전달 안 됨, 은행(총납부금)에 남김
- 팀게임 이월시 다음게임 팀구성: 팀 유지(기본) / 재구성 선택 (기본설정 탭)

**OECD 페널티**
- 가입 기준: 내 보유액이 임계값(기본 6만원) 도달 시 가입 (한 번 가입하면 유지, 전원-1명 가입 시 마지막 1명 자동 가입)
- 이벤트: OB / Hazard / Bunker (횟수), Three Putt (토글), Triple Bogey+ (파3는 Double+, 점수로 자동 감지)
- 홀당 상한 적용, 결과에 항목별 내역 표시 (예: "OB ×2 · Three Putt")
- 18홀(마지막홀) 해제/유지 옵션 (기본 해제 = 마지막 홀은 페널티 없음)

### 2. 방 관리 (`lib/roomStore.ts`)
- 방코드: 숫자 4자리, 생성 시 기존 방과 충돌 검사 (최대 10회 재시도, 덮어쓰기 차단)
- 생성 7일 경과 방 자동 삭제 (방 생성 시 백그라운드 정리)
- `fetchRoomFromServer`: 모바일 절전 복귀 시 서버 강제 동기화용
- 게임 시작 시 1번홀 티샷 순서 랜덤 생성(Fisher-Yates) 후 저장

### 3. 플레이 화면 (`app/play/[roomId]/page.tsx`)
- 실시간 스코어보드 (전반/후반 카드, 그린 톤). 참가자는 현재 홀만 입력 가능, 홀 이동은 진행자 전용
- 팀매치 시: 팀구성 이름을 팀 색(블루/그린)으로 표시, 전반·후반·전체홀 매치일 때 누적 UP 줄(1UP/2UP/T) 표시
- 티샷 순서 팝업: 게임 시작 시 각자 본인 순서만 슬롯머신 연출(3초)로 표시
- 홀 전원 입력 시: 진행자는 결과 카드, 참가자는 결과 팝업 (게임 결과 + 버디 + OECD 페널티 상세)
- `visibilitychange` 시 서버 강제 동기화 (모바일 절전 후 WAIT→LIVE 지연 해결)
- 플레이어 표시 순서: 진행자 지정 순서(playerOrder) 우선, 기본은 진행자→참가 시각 순 (전 기기 동일)

### 4. 게임 설정 (`app/setup/`, `components/GameSettings.tsx`)
- setup: 코스설정 → 기본설정 → 게임선택 → 금액설정 단계별 [다음] 버튼, 금액설정에서 [게임 시작]
- 코스설정: 골프장·전반/후반 코스 입력 + [확정] → 저장된 코스면 홀별 파 자동 적용, 없으면 파4 기본. 저장된 조합은 원터치 칩으로 선택. 확정 전 홀파는 미선택, 18홀 전부 설정해야 진행. 9홀씩 한 줄, 홀 번호 아래 파 표시(파3 점, 파5 막대). [다음] 시 9홀 코스 단위로 `coursePresets`·`courseCombos` 저장
- 기본설정 탭: 기본금액 분배(버디와 독립, 기본 10,000원) + 팀 구성 미정 시(진행자 배정 / A.I 랜덤배정 — 라스베가스·후세인 팀/역할 미정 시, 홀 시드 기반 결정적 랜덤) + 팀게임 이월시 다음게임 팀구성(기본 팀 유지) + OECD 설정(18홀 해제/유지 포함) + 버디값 설정(같은 팀 받기 토글 — 기본 안받기)
- 게임선택 탭: 일반 게임 + Additional Option(신페리오) + 니어리스트·롱기스트(적용 홀·금액, 진행자가 홀에서 당첨자/PASS 선택, 선택 완료까지 홀 결과·다음홀 보류, 당첨금 은행→지갑). **4인 미만이면 팀 게임(라스베가스·팀매치·좌탄우탄)은 선택 불가**(계산 로직은 유지, UI에서만 차단)
- 게임 중 설정(GameSettings)은 setup과 동일 구조 (맨 앞 플레이어 탭 추가)
- 게임 중 설정(GameSettings): 플레이어 관리(▲▼ 순서 변경, 삭제), 동일 설정 항목

---

## 환경 변수 (`.env.local`)

```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=golf-game-166c2.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=golf-game-166c2
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=golf-game-166c2.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=...
```
Vercel에는 프로젝트 Settings → Environment Variables에 동일하게 등록 (빌드 타임 반영이므로 변경 시 Redeploy 필요).

---

## 실행 / 배포

### 로컬 개발
```bash
npm run dev   # http://localhost:3000
```

### 배포 (Vercel 자동)
모노레포에 커밋 후 106 폴더만 subtree split해서 golf_game 저장소로 push하면 Vercel이 자동 재배포한다.
```bash
git add 10-projects/106-golf-game && git commit -m "..."
git subtree split --prefix=10-projects/106-golf-game -b golf-game-split
git push https://github.com/bst2sinokor/golf_game.git golf-game-split:main
git branch -D golf-game-split
```

---

## 구축 과정에서 해결한 이슈

1. **Vercel 빌드에 Firebase 키 누락** — `NEXT_PUBLIC_*`은 빌드 타임에 박히므로 환경변수 등록 후 Redeploy 필요
2. **모바일 가로 스크롤** — 헤더 좌측 영역에 축소 허용(`flex:1, minWidth:0`) + 전역 `overflow-x: hidden`
3. **모바일 드래그 불가** — 플레이어 순서 변경을 HTML5 DnD에서 ▲▼ 버튼으로 교체
4. **모바일 절전 후 동기화 지연** — `visibilitychange` 시 `getDocFromServer`로 강제 동기화
5. **기기마다 스코어보드 순서 상이** — Firestore 맵 키 순서 의존 제거, 결정적 정렬(`orderedPlayerIds`) 도입
6. **방코드 충돌로 기존 방 덮어쓰기 위험** — 생성 시 존재 확인 + 재시도, 7일 경과 방 자동 정리
7. **팀구성 텍스트 잘림** — 게임 태그 줄을 헤더 밖 전체 폭 영역으로 분리, FitText로 폭 부족 시 글자 축소
