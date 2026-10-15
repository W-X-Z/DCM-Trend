'use client';

import { useEffect, useRef, useState } from 'react';

// 첫 방문 안내: 외부에서 만든 테스트용 프로토타입이며 내부 자료를 입력하지 말 것.
// 확인하면 이 브라우저에 기억한다. 문구를 바꾸면 KEY 의 버전을 올려 다시 보이게 한다.
const KEY = 'dcm.notice.v1';
const OPEN = 'dcm:notice';

export function Notice() {
  const ref = useRef<HTMLDialogElement>(null);
  const [acked, setAcked] = useState(true);

  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(KEY) === '1';
    } catch {
      /* 저장소를 못 쓰면 매번 보여 준다 */
    }
    setAcked(seen);
    if (!seen) ref.current?.showModal();
    const open = () => {
      if (!ref.current?.open) ref.current?.showModal();
    };
    window.addEventListener(OPEN, open);
    return () => window.removeEventListener(OPEN, open);
  }, []);

  function confirm() {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* 무시 */
    }
    setAcked(true);
    ref.current?.close();
  }

  return (
    <dialog
      ref={ref}
      className="notice"
      aria-labelledby="notice-h"
      aria-describedby="notice-d"
      onCancel={(e) => {
        // 처음에는 '확인했습니다'를 눌러야 닫힌다
        if (!acked) e.preventDefault();
      }}
    >
      <h2 id="notice-h">테스트용 프로토타입입니다</h2>
      <div id="notice-d" className="notice-body">
        <p>
          현업 의견을 받기 위해 사내 시스템 밖에서 공개 데이터(DART 공시, 한국은행 ECOS)로 만든 화면입니다. 앞으로 사내에
          구축할 딜 제안 Agent와 기능·화면·데이터가 다를 수 있습니다.
        </p>
        <div className="notice-warn">
          <p className="notice-warn-h">내부 자료를 입력하지 마세요</p>
          <p>
            고객 정보, 딜 파이프라인, 사내 문서 내용은 회사 검색·AI 질문·의견 보내기에 적지 마세요. 입력한 내용은 사외
            서버로 전송됩니다.
          </p>
        </div>
      </div>
      <button type="button" className="btn notice-ok" onClick={confirm} autoFocus>
        확인했습니다
      </button>
    </dialog>
  );
}

// 바닥글의 '이용 안내' 링크: 안내 창을 다시 연다
export function NoticeLink() {
  return (
    <button type="button" className="linkish" onClick={() => window.dispatchEvent(new Event(OPEN))}>
      이용 안내
    </button>
  );
}
