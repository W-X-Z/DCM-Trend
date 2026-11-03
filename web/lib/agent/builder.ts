// Agent Builder 실행(서버): 피드백을 분류해 편집 역할(노하우 편집·프롬프트 편집)에 맡기고, 영향 점검을 붙여 수정안을 돌려준다.
// 수정안은 저장하지 않는다. 사용자가 화면에서 승인하면 브라우저가 새 판으로 저장한다.
import 'server-only';
import {
  ASSETS, EDITABLE, MODEL, ROLE_NAME, allItems, applyEdit, assetDef, itemBlock, kstToday, nextItemId, parseItems, parseSections, textOf,
  type AssetTexts, type Block, type BuilderRoleKey, type DevRequest, type Edit, type Msg, type Proposal,
} from './defs';
import { J, ToolError, claude, claudeWhy, clip, obj, runLoop, textOf as textOfBlocks, tidyHistory, usesOf, type ToolDef } from './llm';

export type BuilderEvent =
  | { t: 'text'; text: string }
  | { t: 'tool'; id: string; name: string; label: string; agent: 'master' | BuilderRoleKey; call?: string }
  | { t: 'tool_done'; id: string; ok: boolean; note: string }
  | { t: 'role'; call: string; role: BuilderRoleKey; phase: 'start' | 'end'; text?: string; fail?: boolean }
  | { t: 'proposal'; proposal: Proposal }
  | { t: 'impact'; id: string; text: string }
  | { t: 'dev'; item: DevRequest }
  | { t: 'memory'; text: string }
  | { t: 'done'; messages: Msg[]; cont: boolean; model: string }
  | { t: 'error'; message: string };
export type BuilderInput = { messages: Msg[]; assets: AssetTexts; memory: string | null; seq: number };

const knowhowIds = ASSETS.filter((a) => a.kind === 'knowhow').map((a) => a.id);
const promptIds = EDITABLE.filter((id) => assetDef(id)?.kind === 'prompt');
const titleOf = (id: string) => {
  const a = assetDef(id);
  return a ? `${a.kind === 'knowhow' ? '노하우' : '프롬프트'} · ${a.title}` : id;
};

const LABEL: Record<string, (i: Record<string, unknown>) => string> = {
  list_targets: () => '고칠 곳 목록',
  call_editor: (i) => `편집 맡기기 · ${i.kind === 'prompt' ? '프롬프트 편집' : '노하우 편집'}`,
  call_impact: () => '영향 점검 맡기기',
  record_dev_request: (i) => `개발 요청 남기기 · ${String(i.title ?? '').slice(0, 30)}`,
  record_memory: () => '개인 기억에 남기기',
  list_items: (i) => `노하우 항목 목록${i.asset ? ` · ${titleOf(String(i.asset))}` : ''}`,
  read_item: (i) => `항목 읽기 · ${i.id}`,
  propose_knowhow: (i) => `노하우 수정안 · ${i.op} ${i.id ?? ''}`,
  list_prompts: () => '역할 프롬프트 목록',
  read_prompt: (i) => `프롬프트 읽기 · ${titleOf(String(i.prompt ?? ''))}`,
  propose_prompt: (i) => `프롬프트 수정안 · ${titleOf(String(i.prompt ?? ''))}`,
};
const toolLabel = (n: string, i: Record<string, unknown>) => (LABEL[n] ?? (() => n))(i ?? {});

const LIST_ITEMS: ToolDef = { name: 'list_items', description: '노하우 항목 목록(번호·제목·묶음). asset 을 주면 그 파일만.', input_schema: obj({ asset: { type: 'string', enum: knowhowIds } }) };
const READ_ITEM: ToolDef = { name: 'read_item', description: '노하우 항목 하나의 전체 글', input_schema: obj({ id: { type: 'string' } }, ['id']) };
const LIST_PROMPTS: ToolDef = { name: 'list_prompts', description: '제안서 Agent 역할 프롬프트와 부분(## 제목) 목록', input_schema: obj({}) };
const READ_PROMPT: ToolDef = { name: 'read_prompt', description: '역할 프롬프트 읽기. section 을 주면 그 부분만(소개 문단은 "")', input_schema: obj({ prompt: { type: 'string', enum: promptIds }, section: { type: 'string' } }, ['prompt']) };

const EDITOR_TOOLS: Record<'knowhow' | 'prompt', ToolDef[]> = {
  knowhow: [
    LIST_ITEMS, READ_ITEM,
    {
      name: 'propose_knowhow',
      description: '노하우 한 항목의 수정안. op=replace(id 항목을 고침) | add(asset 파일에 새 항목, after=이 항목 뒤에) | delete(id 항목을 지움). title 과 body(- 조건/- 선택/- 근거 줄)는 replace·add 에 필요.',
      input_schema: obj({
        op: { type: 'string', enum: ['replace', 'add', 'delete'] }, id: { type: 'string' }, asset: { type: 'string', enum: knowhowIds }, after: { type: 'string' },
        title: { type: 'string' }, body: { type: 'string' }, reason: { type: 'string' },
      }, ['op', 'reason']),
    },
  ],
  prompt: [
    LIST_PROMPTS, READ_PROMPT,
    {
      name: 'propose_prompt',
      description: '역할 프롬프트 한 부분의 새 내용(바뀌는 줄만 고치고 나머지는 그대로). section 은 list_prompts 의 부분 제목, 소개 문단은 "".',
      input_schema: obj({ prompt: { type: 'string', enum: promptIds }, section: { type: 'string' }, text: { type: 'string' }, reason: { type: 'string' } }, ['prompt', 'section', 'text', 'reason']),
    },
  ],
};
const IMPACT_TOOLS: ToolDef[] = [LIST_ITEMS, READ_ITEM, READ_PROMPT];

const MASTER_TOOLS: ToolDef[] = [
  { name: 'list_targets', description: '고칠 수 있는 곳 목록: 노하우 파일·항목, 역할 프롬프트·부분', input_schema: obj({}) },
  { name: 'call_editor', description: '편집 역할에게 수정안을 맡긴다. kind=knowhow(노하우 편집) | prompt(프롬프트 편집). task 에 피드백 원문·관련 장표·고칠 곳 후보.', input_schema: obj({ kind: { type: 'string', enum: ['knowhow', 'prompt'] }, task: { type: 'string' } }, ['kind', 'task']) },
  { name: 'call_impact', description: '수정안의 영향 점검(중복·모순·영향 역할·다시 실행)을 맡긴다.', input_schema: obj({ proposal_id: { type: 'string' } }, ['proposal_id']) },
  { name: 'record_dev_request', description: '도구·데이터·화면 기능이 필요한 피드백을 개발 요청으로 남긴다.', input_schema: obj({ title: { type: 'string' }, detail: { type: 'string' } }, ['title', 'detail']) },
  { name: 'record_memory', description: '이 사용자만의 선호를 개인 기억(제안서 Agent)에 한 줄로 남긴다. 예: "- [선호] 답은 3줄 이내로"', input_schema: obj({ text: { type: 'string' } }, ['text']) },
];

export async function runBuilder(inp: BuilderInput, emit: (e: BuilderEvent) => void, budgetMs = 170_000, hardMs = 285_000) {
  const t0 = Date.now();
  const left = () => t0 + hardMs - Date.now();
  const A = inp.assets;
  const messages: Msg[] = tidyHistory(inp.messages);
  const proposals = new Map<string, Proposal>();
  let seq = inp.seq;
  let model = MODEL;
  let calls = 0;
  const lastFeedback = [...messages].reverse().find((m) => m.role === 'user' && typeof m.content === 'string')?.content as string | undefined;

  // ── 공용 읽기 ──
  function listItems(asset?: unknown) {
    const ids = typeof asset === 'string' && knowhowIds.includes(asset) ? [asset] : knowhowIds;
    return ids.map((id) => ({ asset: id, 이름: titleOf(id), 항목: parseItems(id, textOf(A, id)).map((i) => ({ id: i.id, 제목: i.title, 묶음: i.section })) }));
  }
  function readItem(id: unknown) {
    const it = allItems(A).find((x) => x.id === String(id ?? '').trim());
    if (!it) throw new ToolError(`'${id}' 항목이 없어요. list_items 로 번호를 확인하세요.`);
    return { asset: it.asset, 파일: titleOf(it.asset), 묶음: it.section, 글: it.block };
  }
  function readPrompt(prompt: unknown, section: unknown) {
    const id = String(prompt ?? '');
    if (!promptIds.includes(id)) throw new ToolError(`prompt 는 ${promptIds.join(', ')} 중 하나예요.`);
    const t = textOf(A, id);
    if (section == null) return { prompt: id, 역할: titleOf(id), 글: t };
    const s = parseSections(t).find((x) => x.heading === String(section));
    if (!s) throw new ToolError(`'${section}' 부분이 없어요. 부분: ${parseSections(t).map((x) => x.heading || '(소개)').join(', ')}`);
    return { prompt: id, 부분: s.heading || '(소개)', 글: s.body };
  }

  function addProposal(edit: Edit, target: string, before: string, after: string, reason: string) {
    const id = `p${++seq}`;
    const p: Proposal = { id, edit, target, before, after, reason, feedback: (lastFeedback ?? '').slice(0, 600), impact: null, status: 'open', at: new Date().toISOString() };
    proposals.set(id, p);
    emit({ t: 'proposal', proposal: p });
    return p;
  }

  async function editorTool(name: string, i: Record<string, unknown>) {
    switch (name) {
      case 'list_items':
        return { content: J(listItems(i.asset)), note: '' };
      case 'read_item':
        return { content: J(readItem(i.id)), note: '' };
      case 'list_prompts':
        return { content: J(promptIds.map((id) => ({ prompt: id, 역할: titleOf(id), 부분: parseSections(textOf(A, id)).map((s) => s.heading || '(소개)') }))), note: '' };
      case 'read_prompt':
        return { content: J(readPrompt(i.prompt, i.section)), note: '' };
      case 'propose_knowhow': {
        const op = String(i.op ?? '') as 'replace' | 'add' | 'delete';
        const reason = String(i.reason ?? '').slice(0, 400);
        const title = String(i.title ?? '').trim();
        const body = String(i.body ?? '').trim();
        if (op !== 'delete' && (!title || !body)) throw new ToolError('replace·add 에는 title 과 body 가 필요해요.');
        if (op !== 'delete' && !/^- (조건|선택|대상|쓸 것|의견|근거|주의|금지)/m.test(body)) throw new ToolError('body 는 "- 조건: …", "- 선택: ① … (기본) ② …", "- 근거: …" 줄로 써 주세요.');
        let edit: Edit;
        let before = '';
        if (op === 'add') {
          const asset = String(i.asset ?? '');
          if (!knowhowIds.includes(asset)) throw new ToolError(`add 에는 asset(${knowhowIds.join(', ')})이 필요해요.`);
          const id = nextItemId(asset, textOf(A, asset));
          edit = { kind: 'knowhow', asset, op, id, after: typeof i.after === 'string' && i.after ? i.after : null, block: itemBlock(id, title, body) };
        } else if (op === 'replace' || op === 'delete') {
          const it = allItems(A).find((x) => x.id === String(i.id ?? '').trim());
          if (!it) throw new ToolError(`'${i.id}' 항목이 없어요.`);
          before = it.block;
          edit = { kind: 'knowhow', asset: it.asset, op, id: it.id, after: null, block: op === 'delete' ? '' : itemBlock(it.id, title, body) };
        } else throw new ToolError('op 는 replace·add·delete 중 하나예요.');
        applyEdit(textOf(A, edit.asset), edit); // 적용되는지 미리 확인
        const p = addProposal(edit, `${titleOf(edit.asset)} · ${edit.id}`, before, edit.block, reason);
        return { content: J({ 수정안: p.id, 대상: p.target }), note: `${p.id} · ${p.target}` };
      }
      case 'propose_prompt': {
        const id = String(i.prompt ?? '');
        const section = String(i.section ?? '').replace(/^\(소개\)$/, '');
        const text = String(i.text ?? '').trim();
        if (!text) throw new ToolError('text 에 새 내용을 주세요.');
        const cur = readPrompt(id, section);
        const edit: Edit = { kind: 'prompt', asset: id, op: 'replace', section, body: text };
        applyEdit(textOf(A, id), edit);
        if (cur.글.trim() === text) throw new ToolError('바뀐 내용이 없어요.');
        const p = addProposal(edit, `${titleOf(id)} · ${section || '(소개)'}`, cur.글, text, String(i.reason ?? '').slice(0, 400));
        return { content: J({ 수정안: p.id, 대상: p.target }), note: `${p.id} · ${p.target}` };
      }
      default:
        throw new ToolError(`모르는 도구: ${name}`);
    }
  }

  async function runSub(role: BuilderRoleKey, first: string, tools: ToolDef[], call: string) {
    emit({ t: 'role', call, role, phase: 'start' });
    let k = 0;
    try {
      const out = await runLoop({
        model: MODEL, system: `${textOf(A, `builder.${role}`)}\n\n오늘: ${kstToday()}`, first, tools, maxRounds: 8, maxTokens: 3000, left,
        onTool: async (name, input) => {
          const id = `${call}:${role}:${k++}`;
          emit({ t: 'tool', id, name, label: toolLabel(name, input), agent: role, call });
          try {
            const r = await editorTool(name, input);
            emit({ t: 'tool_done', id, ok: true, note: r.note });
            return r;
          } catch (e) {
            const msg = e instanceof ToolError ? e.message : `도구 오류: ${(e as Error).message}`;
            emit({ t: 'tool_done', id, ok: false, note: msg });
            throw new ToolError(msg);
          }
        },
      });
      emit({ t: 'role', call, role, phase: 'end', text: out.text.slice(0, 1500) });
      return out.text;
    } catch (e) {
      const msg = `역할 실행 실패: ${claudeWhy(e)}`;
      emit({ t: 'role', call, role, phase: 'end', text: msg, fail: true });
      return msg;
    }
  }

  async function masterTool(name: string, i: Record<string, unknown>, call: string) {
    switch (name) {
      case 'list_targets':
        return {
          content: J({
            노하우: listItems(),
            프롬프트: promptIds.map((id) => ({ prompt: id, 역할: titleOf(id), 부분: parseSections(textOf(A, id)).map((s) => s.heading || '(소개)') })),
          }),
          note: '',
        };
      case 'call_editor': {
        const kind = i.kind === 'prompt' ? 'prompt' : 'knowhow';
        const before = new Set(proposals.keys());
        const text = await runSub(kind, `피드백 작업: ${String(i.task ?? '').slice(0, 2000)}`, EDITOR_TOOLS[kind], call);
        const made = [...proposals.values()].filter((p) => !before.has(p.id));
        return {
          content: J({ 보고: clip(text, 1500), 수정안: made.map((p) => ({ id: p.id, 대상: p.target, 바뀌기전: clip(p.before, 800), 바뀐후: clip(p.after, 800) })) }),
          note: made.length ? made.map((p) => p.id).join(', ') : '수정안 없음',
        };
      }
      case 'call_impact': {
        const p = proposals.get(String(i.proposal_id ?? ''));
        if (!p) throw new ToolError(`수정안 '${i.proposal_id}' 이 없어요. 있는 수정안: ${[...proposals.keys()].join(', ') || '없음'}`);
        const text = await runSub('impact', `수정안 ${p.id} (${p.target})\n이유: ${p.reason}\n\n[바뀌기 전]\n${p.before || '(새 항목)'}\n\n[바뀐 후]\n${p.after || '(삭제)'}`, IMPACT_TOOLS, call);
        p.impact = text.slice(0, 1500);
        emit({ t: 'impact', id: p.id, text: p.impact });
        return { content: J({ 수정안: p.id, 영향점검: p.impact }), note: '' };
      }
      case 'record_dev_request': {
        const item: DevRequest = { id: `d${Date.now().toString(36)}`, at: new Date().toISOString(), title: String(i.title ?? '').slice(0, 120), detail: String(i.detail ?? '').slice(0, 1200), feedback: (lastFeedback ?? '').slice(0, 600), status: 'open' };
        if (!item.title) throw new ToolError('title 을 주세요.');
        emit({ t: 'dev', item });
        return { content: J({ 남김: item.title }), note: item.title };
      }
      case 'record_memory': {
        const text = String(i.text ?? '').trim().slice(0, 300);
        if (!text) throw new ToolError('text 를 주세요.');
        emit({ t: 'memory', text: text.startsWith('-') ? text : `- ${text}` });
        return { content: J({ 남김: text }), note: '' };
      }
      default:
        throw new ToolError(`모르는 도구: ${name}`);
    }
  }

  const system = `${textOf(A, 'builder.master')}

## 고칠 수 있는 대상
- 노하우: ${knowhowIds.map(titleOf).join(', ')}
- 프롬프트: ${promptIds.map((id) => `${titleOf(id)}(${id})`).join(', ')}
- 역할 이름: ${Object.values(ROLE_NAME).join(', ')}

## 사용자 기억 (개인)
${inp.memory?.trim() || '(없음)'}

오늘: ${kstToday()}`;

  for (let round = 0; round < 12; round++) {
    if (Date.now() - t0 > budgetMs) {
      emit({ t: 'done', messages, cont: true, model });
      return;
    }
    let res;
    try {
      res = await claude(MODEL, system, messages, MASTER_TOOLS, 2500, left());
    } catch (e) {
      emit({ t: 'error', message: claudeWhy(e) });
      emit({ t: 'done', messages, cont: false, model });
      return;
    }
    model = res.model ?? model;
    let content = res.content;
    if (res.stop_reason !== 'tool_use' && content.some((b) => b.type === 'tool_use')) content = content.filter((b) => b.type !== 'tool_use');
    if (!content.length) content = [{ type: 'text', text: '(빈 응답)' }];
    messages.push({ role: 'assistant', content });
    const said = textOfBlocks(content);
    if (said) emit({ t: 'text', text: said });
    const uses = usesOf(content);
    if (!uses.length) {
      emit({ t: 'done', messages, cont: false, model });
      return;
    }
    const results: Block[] = [];
    for (const u of uses) {
      const id = `b${calls++}:${u.id.slice(-6)}`;
      emit({ t: 'tool', id, name: u.name, label: toolLabel(u.name, u.input ?? {}), agent: 'master' });
      try {
        const r = await masterTool(u.name, u.input ?? {}, id);
        results.push({ type: 'tool_result', tool_use_id: u.id, content: r.content || '(빈 결과)' });
        emit({ t: 'tool_done', id, ok: true, note: r.note });
      } catch (e) {
        const msg = e instanceof ToolError ? e.message : `도구 오류: ${(e as Error).message}`;
        results.push({ type: 'tool_result', tool_use_id: u.id, content: msg, is_error: true });
        emit({ t: 'tool_done', id, ok: false, note: msg });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  emit({ t: 'done', messages, cont: true, model });
}

