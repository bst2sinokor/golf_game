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
│   │   ├── page.tsx               # 첫 화면 (방 만들기 / 방 참가하기)
│   │   ├── layout.tsx             # 루트 레이아웃, viewport 설정
│   │   ├── globals.css            # 전역 스타일, 애니메이션 (livePulse, waitBlink)
│   │   ├── setup/[roomId]/        # 진행자 게임 설정 (코스→게임선택→금액→기타→시작)
│   │   ├── play/[roomId]/         # 메인 플레이 화면 (스코어보드, 점수 입력)
│   │   └── result/[roomId]/       # 최종 정산 결과
│   ├── components/
│   │   └── GameSettings.tsx       # 게임 중 설정 변경 (플레이어 관리 포함)
│   └── lib/
│       ├── firebase.ts            # Firebase 초기화 (환경변수 기반)
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

**지원 게임 (7종)**
| 게임 | 방식 |
|------|------|
| 스트로크 | 홀 최저타 승자가 홀당 설정금액(+이월)만 수령, 동점 이월 |
| 라스베가스 | 직전 홀 순위로 1+4위 vs 2+3위 팀 (진행자 직접 지정 가능) |
| 팀 매치플레이 | 고정 팀(블루/그린), 팀 합산 타수 자동 판정, 무승부 이월. 스코어보드에 NUP/T 누적 표시 |
| 좌탄우탄 | 홀마다 티샷 방향(좌/우)으로 팀 구성 |
| 후세인 | 직전 홀 2등 1명 vs 나머지 3명, 후세인 승리 시 설정금액 ×3 독식 |
| 스크래치 | 쌍별 타수 차 × 타당 금액 직접 정산 |
| 신페리오 | 18홀 종료 후 핸디캡 넷스코어 타수차 쌍별 정산 (지갑 무관, 결과 화면 별도 카드) |

**OECD 페널티**
- 가입 기준: 내 보유액이 임계값(기본 6만원) 도달 시 가입 (한 번 가입하면 유지, 전원-1명 가입 시 마지막 1명 자동 가입)
- 이벤트: OB / Hazard / Bunker (횟수), Three Putt (토글), Triple Bogey+ (파3는 Double+, 점수로 자동 감지)
- 홀당 상한 적용, 결과에 항목별 내역 표시 (예: "OB ×2 · Three Putt")

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
- setup: 코스설정 → 게임선택 → 금액설정 → 기타 단계별 [다음] 버튼, 마지막에 [게임 시작]
- 코스설정: 골프장·코스 입력(기본 스마트KU/혼솔-바른) + 홀별 파(기본 전 홀 파4, 전반·후반 각 9홀 한 줄). [다음] 시 Firestore `coursePresets`에 저장되어 같은 골프장·코스 선택 시 홀별 파 자동 적용
- 기타 탭: OECD 설정 + 버디값 설정 (활성화 시 기본 10,000원, 같은 팀 버디값 받기 토글 — 기본 안받기) + 니어리스트·롱기스트 (적용 홀·금액 설정, 진행자가 홀에서 당첨자/PASS 선택, 선택 완료까지 홀 결과·다음홀 이동 보류, 당첨금은 은행→지갑)
- 게임선택·니어/롱기 홀 그리드의 홀 번호 아래 파 표시 (파3 `·`, 파4 없음, 파5 `-`)
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
모노레포에 커밋 후 106 폴더만 subtree split해서 golf_game 저장소로 push하면 Vercel이 자동 재배포한다:
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
