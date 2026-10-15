'use client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="wrap">
      <div className="page-head">
        <h1 className="page-title">데이터를 불러오지 못했습니다</h1>
        <p className="page-sub">데이터베이스 응답이 늦거나 끊겼습니다. 잠시 뒤 다시 시도하세요.</p>
        <p style={{ marginTop: 16 }}>
          <button type="button" className="btn" onClick={reset}>다시 시도</button>
        </p>
      </div>
    </main>
  );
}
