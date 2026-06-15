// 후원(응원) 링크 설정 — 여기 한 곳만 고치면 전체에 반영됩니다.
// 링크가 빈 문자열('')이면 해당 수단 버튼은 자동으로 숨겨집니다.

export const DONATION = {
  // 카카오페이 송금받기 링크 (qr.kakaopay.com/...)
  kakaopay: 'https://qr.kakaopay.com/281006011000070296814897',
  // 네이버페이 QR송금 링크 (pay.naver.com/remit/qr/...)
  naverpay: 'https://pay.naver.com/remit/qr/inflow?v=1&a=49120059847&c=023&d=e6a6b19e0934d19ccef7b05c0e866201',
}

// 하나라도 링크가 있으면 후원 진입점을 노출
export const DONATION_ENABLED = Boolean(DONATION.kakaopay || DONATION.naverpay)
