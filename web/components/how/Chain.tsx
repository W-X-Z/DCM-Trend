// '작동 방식' 화면의 흐름 상자: 데이터 → 규칙 → AI → 검증 → 결과. 종류는 색과 글자로 함께 표시한다.
export type Kind = 'data' | 'rule' | 'human' | 'ai' | 'check' | 'out';
export type Node = { kind: Kind; title: string; sub?: string; loop?: boolean };

export const KIND_LABEL: Record<Kind, string> = {
  data: '데이터',
  rule: '규칙·SQL',
  human: '사람',
  ai: 'AI',
  check: '검증',
  out: '결과',
};

export function Chain({ nodes, label }: { nodes: Node[]; label: string }) {
  return (
    <ol className="hw-chain" aria-label={label}>
      {nodes.map((n, i) => (
        <li key={`${n.title}-${i}`} className={`hw-node k-${n.kind}${n.loop ? ' is-loop' : ''}`}>
          <span className="hw-kind">{KIND_LABEL[n.kind]}</span>
          <strong>{n.title}</strong>
          {n.sub && <span className="hw-sub">{n.sub}</span>}
        </li>
      ))}
    </ol>
  );
}

export function Legend() {
  return (
    <ul className="hw-legend small" aria-label="상자 종류">
      {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
        <li key={k} className={`k-${k}`}><span className="hw-dot" aria-hidden />{KIND_LABEL[k]}</li>
      ))}
    </ul>
  );
}
