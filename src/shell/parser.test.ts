import { describe, it, expect } from 'vitest'
import { parse, type CommandNode } from './parser'

const raw = (text: string) => [{ kind: 'raw' as const, text }]

/**
 * 파이프라인 첫 단계를 단순 명령(CommandNode)으로 좁혀 준다. commands[] 가 Command
 * 유니온이 된 뒤(task 4), 단순 명령 필드(words/assignments/redirs)에 접근하려면 좁히기가
 * 필요하다. 복합 명령이면 즉시 실패시킨다.
 */
function firstCmd(input: string): CommandNode {
  const c = parse(input).items[0]!.pipeline.commands[0]!
  if (c.kind !== 'command') throw new Error(`expected simple command, got ${c.kind}`)
  return c
}

describe('parse', () => {
  it('단일 명령을 파싱한다', () => {
    const ast = parse('ls -a')
    expect(ast.items).toHaveLength(1)
    expect(ast.items[0]!.op).toBeNull()
    const cmd = firstCmd('ls -a')
    expect(cmd.words).toEqual([raw('ls'), raw('-a')])
    expect(cmd.redirs).toEqual([])
  })

  it('파이프라인을 파싱한다', () => {
    const ast = parse('cat f | grep x | wc -l')
    expect(ast.items[0]!.pipeline.commands).toHaveLength(3)
  })

  it('&& 와 || 와 ; 를 연결자로 기록한다', () => {
    const ast = parse('a && b || c ; d')
    expect(ast.items.map((i) => i.op)).toEqual([null, '&&', '||', ';'])
  })

  it('후행 세미콜론은 빈 항목을 만들지 않는다', () => {
    expect(parse('ls ;').items).toHaveLength(1)
  })

  it('출력 리다이렉션을 fd 1로 기록한다', () => {
    const cmd = firstCmd('echo hi > out.txt')
    expect(cmd.redirs).toEqual([{ fd: 1, op: '>', target: raw('out.txt') }])
    expect(cmd.words).toEqual([raw('echo'), raw('hi')])
  })

  it('추가 리다이렉션 >>', () => {
    const cmd = firstCmd('echo hi >> out')
    expect(cmd.redirs[0]).toEqual({ fd: 1, op: '>>', target: raw('out') })
  })

  it('입력 리다이렉션을 fd 0으로 기록한다', () => {
    const cmd = firstCmd('wc -l < in')
    expect(cmd.redirs[0]).toEqual({ fd: 0, op: '<', target: raw('in') })
  })

  it('2> 와 2>> 를 fd 2로 기록한다', () => {
    expect(firstCmd('cmd 2> e').redirs[0])
      .toEqual({ fd: 2, op: '>', target: raw('e') })
    expect(firstCmd('cmd 2>> e').redirs[0])
      .toEqual({ fd: 2, op: '>>', target: raw('e') })
  })

  it('리다이렉션이 명령 중간에 와도 된다', () => {
    const cmd = firstCmd('echo > out hi')
    expect(cmd.words).toEqual([raw('echo'), raw('hi')])
    expect(cmd.redirs).toHaveLength(1)
  })

  it('여러 리다이렉션을 순서대로 모은다', () => {
    const cmd = firstCmd('cmd > o 2> e < i')
    expect(cmd.redirs.map((r) => r.fd)).toEqual([1, 2, 0])
  })

  it('선행 변수 대입을 분리한다', () => {
    const cmd = firstCmd('FOO=bar ls')
    expect(cmd.assignments).toEqual([{ name: 'FOO', value: raw('bar') }])
    expect(cmd.words).toEqual([raw('ls')])
  })

  it('명령 없는 순수 대입도 파싱한다', () => {
    const cmd = firstCmd('X=1')
    expect(cmd.assignments).toHaveLength(1)
    expect(cmd.words).toEqual([])
  })

  it('명령 뒤에 오는 FOO=bar 는 대입이 아니라 인자다', () => {
    const cmd = firstCmd('echo FOO=bar')
    expect(cmd.assignments).toEqual([])
    expect(cmd.words).toHaveLength(2)
  })

  it('따옴표 붙은 FOO 는 대입이 아니다', () => {
    const cmd = firstCmd(`'FOO'=bar`)
    expect(cmd.assignments).toEqual([])
  })

  it('리다이렉션 대상이 없으면 던진다', () => {
    expect(() => parse('echo >')).toThrow(/syntax error/)
  })

  it('파이프 뒤에 명령이 없으면 던진다', () => {
    expect(() => parse('ls |')).toThrow(/syntax error/)
  })

  it('&& 로 시작하면 던진다', () => {
    expect(() => parse('&& ls')).toThrow(/syntax error/)
  })

  it('빈 입력은 항목 없는 리스트다', () => {
    expect(parse('   ').items).toEqual([])
  })

  // --- 아래는 브리프의 17개 테스트에 없던 함정들을 검증하는 추가 테스트다.
  // 각 항목은 실제 bash(Docker, debian:stable-slim bash 5)로 대조 확인했다 — 보고서 참조.

  it('빈 문자열도 던지지 않고 빈 리스트를 만든다', () => {
    expect(parse('')).toEqual({ kind: 'list', items: [] })
  })

  it('명령 없이 리다이렉션만 있어도 유효하다 (bash: `> out`은 exit 0)', () => {
    const cmd = firstCmd('> out')
    expect(cmd.words).toEqual([])
    expect(cmd.assignments).toEqual([])
    expect(cmd.redirs).toEqual([{ fd: 1, op: '>', target: raw('out') }])
  })

  it('|| 로 끝나면 던진다 (bash: unexpected end of file)', () => {
    expect(() => parse('ls ||')).toThrow(/syntax error/)
  })

  it('세미콜론으로 시작하면 던진다 (bash: syntax error near `;\')', () => {
    expect(() => parse('; ls')).toThrow(/syntax error/)
  })

  it('&& 로 시작하면 근접 토큰을 메시지에 포함한다', () => {
    expect(() => parse('&& ls')).toThrow(/&&/)
  })

  // 트랩 12: 대입 값의 따옴표 보존.
  // 브리프의 원안(ASSIGN_RE를 pureRaw()가 반환한 "평탄화된 문자열"에 매칭시키고
  // 값을 [{kind:'raw', text: m[2]}] 로 재구성)은 두 가지로 깨진다:
  //   1) X="a b" 는 파츠가 [raw:'X=', dquote:'a b'] 라서 pureRaw()가 null을 반환 →
  //      대입으로 전혀 인식되지 않는다 (실제 bash는 대입으로 처리, $X == "a b").
  //   2) 설사 인식되더라도 값을 raw 로 재작성하면 큰따옴표/작은따옴표 구분이
  //      사라진다 — Task 7 확장기가 이 태그로 확장·분할·글롭 여부를 결정하므로 손실이다.
  // 수정한 tryAssignment()는 word[0]이 raw이고 그 안에 NAME= 가 있는지만 보고,
  // 값은 원래 조각들을 (첫 조각의 나머지 + 이후 조각 그대로) 이어붙여 만든다.
  it('X="a b" 는 대입이고 값은 dquote 조각을 그대로 보존한다', () => {
    const cmd = firstCmd('X="a b"')
    expect(cmd.assignments).toEqual([{ name: 'X', value: [{ kind: 'dquote', text: 'a b' }] }])
  })

  it("X='a b' 는 대입이고 값은 literal 조각을 그대로 보존한다", () => {
    const cmd = firstCmd("X='a b'")
    expect(cmd.assignments).toEqual([{ name: 'X', value: [{ kind: 'literal', text: 'a b' }] }])
  })

  it('X=a"b"c 는 raw/dquote/raw 세 조각이 순서대로 남는다', () => {
    const cmd = firstCmd('X=a"b"c')
    expect(cmd.assignments).toEqual([
      {
        name: 'X',
        value: [
          { kind: 'raw', text: 'a' },
          { kind: 'dquote', text: 'b' },
          { kind: 'raw', text: 'c' },
        ],
      },
    ])
  })

  it('X= (빈 값) 은 대입이고 값은 빈 Word다', () => {
    const cmd = firstCmd('X=')
    expect(cmd.assignments).toEqual([{ name: 'X', value: [] }])
  })

  it('X=a=b 는 첫 = 에서만 나뉜다', () => {
    const cmd = firstCmd('X=a=b')
    expect(cmd.assignments).toEqual([{ name: 'X', value: raw('a=b') }])
  })

  it('FOO"BAR"=baz 는 이름 중간에 따옴표가 있어 대입이 아니라 명령이다', () => {
    const cmd = firstCmd('FOO"BAR"=baz')
    expect(cmd.assignments).toEqual([])
    expect(cmd.words).toHaveLength(1)
  })

  it('여러 선행 대입을 모두 모은다', () => {
    const cmd = firstCmd('FOO=bar BAZ=qux echo hi')
    expect(cmd.assignments).toEqual([
      { name: 'FOO', value: raw('bar') },
      { name: 'BAZ', value: raw('qux') },
    ])
    expect(cmd.words).toEqual([raw('echo'), raw('hi')])
  })

  // --- 개행 fold + # 주석(렉서 Task 1)이 parseList 단에서도 안전한지 검증한다.
  // 렉서의 ; 억누름 방어(선행/연속 개행 + | && || 뒤 라인 컨티뉴에이션)의 목적은
  // parseList가 빈/반복 분리자에 던지지 않게 하는 것이므로, tokenize() 모양뿐 아니라
  // 여기서 parse()를 직접 호출해 던지지 않음 + 항목 수를 확인한다.
  describe('개행 fold가 parseList를 깨지 않는다', () => {
    it('선행 빈 줄이 있어도 던지지 않고 한 항목이다', () => {
      expect(() => parse('\n\necho hi\n')).not.toThrow()
      expect(parse('\n\necho hi\n').items).toHaveLength(1)
    })

    it('중간 빈 줄은 항목을 늘리지 않고 두 항목(echo a ; echo b)이다', () => {
      expect(() => parse('echo a\n\necho b')).not.toThrow()
      expect(parse('echo a\n\necho b').items).toHaveLength(2)
    })

    it('&& 뒤 개행은 라인 컨티뉴에이션이라 && 리스트 하나로 이어진다 (mkdir a && mkdir b)', () => {
      // 실제 bash 확인: mkdir a &&\nmkdir b 는 한 && 리스트로 실행된다 (a, b 둘 다 생성).
      // AST에서 &&는 리스트 연결자라 items가 2개가 되지만(ops [null,'&&']), 핵심은
      // 두 mkdir가 && 로 이어진 하나의 논리적 리스트라는 것 — `&& ; mkdir b` 로 깨져
      // 던지지 않는다(Fix 1의 회귀 게이트).
      expect(() => parse('mkdir a &&\nmkdir b')).not.toThrow()
      const ast = parse('mkdir a &&\nmkdir b')
      expect(ast.items.map((i) => i.op)).toEqual([null, '&&'])
      const c0 = ast.items[0]!.pipeline.commands[0]!
      const c1 = ast.items[1]!.pipeline.commands[0]!
      if (c0.kind !== 'command' || c1.kind !== 'command') throw new Error('expected simple commands')
      expect(c0.words).toEqual([raw('mkdir'), raw('a')])
      expect(c1.words).toEqual([raw('mkdir'), raw('b')])
    })

    it('| 뒤 개행은 라인 컨티뉴에이션이라 한 파이프라인이다 (echo x | cat)', () => {
      // 실제 bash 확인: echo x |\ncat 는 한 파이프라인이다 (x 출력).
      // | 는 파이프라인 내부 연결자라 items는 1개, 그 안에 명령 2개.
      expect(() => parse('echo x |\ncat')).not.toThrow()
      const ast = parse('echo x |\ncat')
      expect(ast.items).toHaveLength(1)
      expect(ast.items[0]!.pipeline.commands).toHaveLength(2)
    })

    it('|| 뒤 개행은 라인 컨티뉴에이션이라 || 리스트 하나로 이어진다 (cmd1 || cmd2)', () => {
      // 실제 bash 확인: false ||\necho y 는 한 || 리스트로 실행된다 (y 출력).
      expect(() => parse('cmd1 ||\ncmd2')).not.toThrow()
      expect(parse('cmd1 ||\ncmd2').items.map((i) => i.op)).toEqual([null, '||'])
    })
  })

  // --- 복합 명령 (task 4): if / while / until. commands[] 가 Command 유니온이 되고,
  // 첫 WORD 가 bare 예약어(if/while/until)면 복합 노드로 라우팅된다.
  describe('복합 명령 파싱 (task 4)', () => {
    it('if 를 IfNode 로 파싱하고 cond/then 은 ListNode 다', () => {
      const cmd = parse('if true; then echo hi; fi').items[0]!.pipeline.commands[0]!
      expect(cmd.kind).toBe('if')
      if (cmd.kind !== 'if') throw new Error('expected if')
      expect(cmd.cond.kind).toBe('list')
      expect(cmd.cond.items[0]!.pipeline.commands[0]).toMatchObject({ kind: 'command', words: [raw('true')] })
      expect(cmd.then.kind).toBe('list')
      expect(cmd.then.items[0]!.pipeline.commands[0]).toMatchObject({ words: [raw('echo'), raw('hi')] })
      expect(cmd.elifs).toEqual([])
      expect(cmd.else).toBeUndefined()
    })

    it('if/elif/else 를 elifs 배열과 else 로 분리한다', () => {
      const cmd = parse('if false; then :; elif true; then echo e; else echo x; fi').items[0]!.pipeline.commands[0]!
      if (cmd.kind !== 'if') throw new Error('expected if')
      expect(cmd.elifs).toHaveLength(1)
      expect(cmd.elifs[0]!.cond.items[0]!.pipeline.commands[0]).toMatchObject({ words: [raw('true')] })
      expect(cmd.elifs[0]!.then.items[0]!.pipeline.commands[0]).toMatchObject({ words: [raw('echo'), raw('e')] })
      expect(cmd.else!.items[0]!.pipeline.commands[0]).toMatchObject({ words: [raw('echo'), raw('x')] })
    })

    it('while 를 WhileNode 로 파싱한다 (until=false)', () => {
      const cmd = parse('while true; do echo x; done').items[0]!.pipeline.commands[0]!
      expect(cmd.kind).toBe('while')
      if (cmd.kind !== 'while') throw new Error('expected while')
      expect(cmd.until).toBe(false)
      expect(cmd.cond.items[0]!.pipeline.commands[0]).toMatchObject({ words: [raw('true')] })
      expect(cmd.body.items[0]!.pipeline.commands[0]).toMatchObject({ words: [raw('echo'), raw('x')] })
    })

    it('until 은 until=true 인 WhileNode 다', () => {
      const cmd = parse('until false; do echo x; done').items[0]!.pipeline.commands[0]!
      expect(cmd.kind).toBe('while')
      if (cmd.kind !== 'while') throw new Error('expected while')
      expect(cmd.until).toBe(true)
    })

    it('멀티라인 if 는 한 줄 세미콜론 버전과 같은 AST 를 만든다', () => {
      expect(parse('if true\nthen echo hi\nfi')).toEqual(parse('if true; then echo hi; fi'))
    })

    it('예약어는 명령 위치에서만 예약어다: echo if 의 if 는 인자다', () => {
      const cmd = parse('echo if').items[0]!.pipeline.commands[0]!
      expect(cmd.kind).toBe('command')
      if (cmd.kind !== 'command') throw new Error('expected command')
      expect(cmd.words).toEqual([raw('echo'), raw('if')])
    })

    it('따옴표 붙은 키워드는 예약어가 아니라 명령이다: "if" / \'while\'', () => {
      expect(parse(`'if'`).items[0]!.pipeline.commands[0]!.kind).toBe('command')
      expect(parse(`"while"`).items[0]!.pipeline.commands[0]!.kind).toBe('command')
    })

    it('닫히지 않은 if 는 문법 오류다', () => {
      expect(() => parse('if true; then echo hi')).toThrow(/syntax error/)
    })

    it('done 없이 끝난 while 은 문법 오류다', () => {
      expect(() => parse('while true; do echo x')).toThrow(/syntax error/)
    })

    it('복합 명령도 파이프라인/리스트에 참여한다', () => {
      const ast = parse('if true; then echo a; fi | cat')
      expect(ast.items[0]!.pipeline.commands).toHaveLength(2)
      expect(ast.items[0]!.pipeline.commands[0]!.kind).toBe('if')
      expect(ast.items[0]!.pipeline.commands[1]!.kind).toBe('command')
    })
  })

  // --- for (task 5): for NAME in WORD*; do BODY; done
  describe('for 파싱 (task 5)', () => {
    it('for 를 ForNode 로 파싱한다: var/words/body', () => {
      const cmd = parse('for x in a b c; do echo $x; done').items[0]!.pipeline.commands[0]!
      expect(cmd.kind).toBe('for')
      if (cmd.kind !== 'for') throw new Error('expected for')
      expect(cmd.var).toBe('x')
      expect(cmd.words).toEqual([raw('a'), raw('b'), raw('c')])
      expect(cmd.body.kind).toBe('list')
      expect(cmd.body.items[0]!.pipeline.commands[0]).toMatchObject({ words: [raw('echo'), [{ kind: 'raw', text: '$x' }]] })
    })

    it('빈 단어 목록도 파싱된다: for x in; do ...; done', () => {
      const cmd = parse('for x in; do echo $x; done').items[0]!.pipeline.commands[0]!
      if (cmd.kind !== 'for') throw new Error('expected for')
      expect(cmd.words).toEqual([])
    })

    it('멀티라인 for 는 한 줄 세미콜론 버전과 같은 AST 를 만든다', () => {
      // do 뒤 개행이 body 앞에 "군더더기 ;" 를 남기던 한계(task 4/5 스캐폴딩)는
      // task 5b의 skipSeparators() 로 고쳐졌다 — 아래 '개행 (newline_list) 허용
      // (task 5b)' describe 블록이 그 케이스(개행이 do 뒤에 오는 경우 포함)를
      // 전담해서 검증한다. 이 테스트는 원래 형태(개행이 word-list 뒤/do 앞)만 유지한다.
      expect(parse('for x in a b\ndo echo $x\ndone')).toEqual(parse('for x in a b; do echo $x; done'))
    })

    it('예약어는 명령 위치에서만 예약어다: echo for/in 의 for/in 은 인자다', () => {
      const cmd = parse('echo for in').items[0]!.pipeline.commands[0]!
      expect(cmd.kind).toBe('command')
      if (cmd.kind !== 'command') throw new Error('expected command')
      expect(cmd.words).toEqual([raw('echo'), raw('for'), raw('in')])
    })

    it('in 없이 끝난 for 는 문법 오류다', () => {
      expect(() => parse('for x a b c; do echo $x; done')).toThrow(/syntax error/)
    })

    it('done 없이 끝난 for 는 문법 오류다', () => {
      expect(() => parse('for x in a b c; do echo $x')).toThrow(/syntax error/)
    })

    it('복합 명령도 파이프라인/리스트에 참여한다', () => {
      const ast = parse('for x in a; do echo $x; done | cat')
      expect(ast.items[0]!.pipeline.commands).toHaveLength(2)
      expect(ast.items[0]!.pipeline.commands[0]!.kind).toBe('for')
      expect(ast.items[0]!.pipeline.commands[1]!.kind).toBe('command')
    })
  })

  // --- task 5b: do/then/else/in 바로 뒤의 개행은 newline_list(허용, 무시)지 명령
  // 분리자(;)가 아니다. 렉서는 개행을 무조건 ; 로 접기 때문에(task 1), 이 자리의
  // 개행이 ;로 둔갑해 본문 parseList가 선행 ;를 문법 오류로 거부했다 — 이 버그를
  // skipSeparators()로 고친다. 실제 bash로 대조 확인(docker debian:stable-slim bash):
  //   for f in a b; do\necho $f\ndone       → a\nb (실제 bash: 정상)
  //   while true; do\necho x\nbreak\ndone   → x   (실제 bash: 정상)
  //   if true; then\necho hi\nfi            → hi  (실제 bash: 정상)
  //   if false; then\n:\nelse\necho no\nfi  → no  (실제 bash: 정상)
  //   for f in\na b\ndo\necho $f\ndone      → 실제 bash는 여기서 문법 오류
  //     (`in` 뒤 개행은 bash 문법에서 별도 취급 안 됨) — 그래도 우리는 관대하게
  //     받아준다(브리프 지시: do/then/else/in 뒤 개행은 전부 관대히 허용).
  //   for f in a b; do; echo x; done        → 실제 bash는 `do;`에서 문법 오류
  //     (list_terminator 뒤에 또 다른 list_terminator는 안 됨) — 우리는 관대하게
  //     받아준다(개행이 접힌 ;와 진짜 ;를 렉서가 구분 못 하므로 동일하게 처리).
  describe('do/then/else/in 뒤 개행 (newline_list) 허용 (task 5b)', () => {
    it('멀티라인 for 본문(개행이 do 뒤에)은 세미콜론 버전과 같은 AST 를 만든다', () => {
      expect(parse('for f in a b; do\necho $f\ndone')).toEqual(parse('for f in a b; do echo $f; done'))
    })

    it('멀티라인 while 본문(개행이 do 뒤에)은 세미콜론 버전과 같은 AST 를 만든다', () => {
      expect(parse('while true; do\necho x\nbreak\ndone')).toEqual(parse('while true; do echo x; break; done'))
    })

    it('멀티라인 if 본문(개행이 then 뒤에)은 세미콜론 버전과 같은 AST 를 만든다', () => {
      expect(parse('if true; then\necho hi\nfi')).toEqual(parse('if true; then echo hi; fi'))
    })

    it('멀티라인 if/else 본문(개행이 then/else 뒤에)은 세미콜론 버전과 같은 AST 를 만든다', () => {
      expect(parse('if false; then\n:\nelse\necho no\nfi')).toEqual(parse('if false; then :; else echo no; fi'))
    })

    it('멀티라인 if/elif/else 본문(개행이 then 뒤에)은 세미콜론 버전과 같은 AST 를 만든다', () => {
      expect(parse('if false; then\n:\nelif true; then\necho e\nfi')).toEqual(
        parse('if false; then :; elif true; then echo e; fi'),
      )
    })

    it('in 뒤 개행도 관대히 허용한다(실제 bash는 문법 오류지만 의도된 관대함): for f in\\na b\\ndo... 는 do echo $f; done 버전과 같은 AST', () => {
      expect(parse('for f in\na b\ndo\necho $f\ndone')).toEqual(parse('for f in a b; do echo $f; done'))
    })

    it('회귀: for x in; do echo empty; done (빈 단어 목록)은 여전히 빈 목록이다', () => {
      const cmd = parse('for x in; do echo empty; done').items[0]!.pipeline.commands[0]!
      if (cmd.kind !== 'for') throw new Error('expected for')
      expect(cmd.words).toEqual([])
      expect(cmd.body.items[0]!.pipeline.commands[0]).toMatchObject({ words: [raw('echo'), raw('empty')] })
    })

    it('관대함: do 뒤에 진짜 세미콜론이 와도(`do; echo x; done`) 받아준다(실제 bash는 문법 오류)', () => {
      expect(() => parse('while true; do; echo x; done')).not.toThrow()
      expect(parse('while true; do; echo x; done')).toEqual(parse('while true; do echo x; done'))
    })

    it('중첩: 바깥/안쪽 본문이 모두 다음 줄에 있어도 파싱된다 (while > if)', () => {
      const ast = parse('while true; do\nif true; then\nbreak\nfi\ndone')
      expect(() => ast).not.toThrow()
      const outer = ast.items[0]!.pipeline.commands[0]!
      if (outer.kind !== 'while') throw new Error('expected while')
      const inner = outer.body.items[0]!.pipeline.commands[0]!
      expect(inner.kind).toBe('if')
    })
  })

  // --- case (task 6): case WORD in [(] PATTERN [| PATTERN]* ) LIST ;; ]* esac.
  // `(`/`)` 는 렉서 연산자가 아니라(OPERATORS 에 없음) 인접 WORD 의 raw 조각에 그냥
  // 흡수돼 있다(`h*)` 는 통째로 raw "h*)") — parseCasePatterns 가 그 raw 텍스트를
  // stripLeadingParen/splitTrailingParen 으로 깐다. `|` 는 파이프와 같은 렉서 토큰이지만
  // 이 자리에선 패턴 구분자로 읽는다.
  describe('case 파싱 (task 6)', () => {
    it('단일 branch 를 CaseNode 로 파싱한다: word/patterns/body', () => {
      const cmd = parse('case hi in h*) echo H;; esac').items[0]!.pipeline.commands[0]!
      expect(cmd.kind).toBe('case')
      if (cmd.kind !== 'case') throw new Error('expected case')
      expect(cmd.word).toEqual(raw('hi'))
      expect(cmd.branches).toHaveLength(1)
      expect(cmd.branches[0]!.patterns).toEqual([raw('h*')])
      expect(cmd.branches[0]!.body.items[0]!.pipeline.commands[0]).toMatchObject({ words: [raw('echo'), raw('H')] })
    })

    it('여러 branch(catch-all 포함)를 순서대로 파싱한다', () => {
      const cmd = parse('case hi in h*) echo H;; *) echo other;; esac').items[0]!.pipeline.commands[0]!
      if (cmd.kind !== 'case') throw new Error('expected case')
      expect(cmd.branches).toHaveLength(2)
      expect(cmd.branches[0]!.patterns).toEqual([raw('h*')])
      expect(cmd.branches[1]!.patterns).toEqual([raw('*')])
      expect(cmd.branches[1]!.body.items[0]!.pipeline.commands[0]).toMatchObject({ words: [raw('echo'), raw('other')] })
    })

    it('`|` 로 이어진 alternation 은 patterns 배열에 여러 항목으로 들어간다', () => {
      const cmd = parse('case cat in cat|dog) echo pet;; esac').items[0]!.pipeline.commands[0]!
      if (cmd.kind !== 'case') throw new Error('expected case')
      expect(cmd.branches[0]!.patterns).toEqual([raw('cat'), raw('dog')])
    })

    it('여는 `(` 는 선택적이고 무시된다: (h*)', () => {
      const withParen = parse('case hi in (h*) echo H;; esac').items[0]!.pipeline.commands[0]!
      const withoutParen = parse('case hi in h*) echo H;; esac').items[0]!.pipeline.commands[0]!
      expect(withParen).toEqual(withoutParen)
    })

    it('마지막 branch 의 `;;` 는 생략 가능하다(단일 `;` 로 esac 직전 종료)', () => {
      const withDoubleSemi = parse('case hi in h*) echo H;; esac')
      const withSingleSemi = parse('case hi in h*) echo H; esac')
      expect(withSingleSemi).toEqual(withDoubleSemi)
    })

    it('빈 body 도 허용한다: h*) ;; esac', () => {
      const cmd = parse('case hi in h*) ;; esac').items[0]!.pipeline.commands[0]!
      if (cmd.kind !== 'case') throw new Error('expected case')
      expect(cmd.branches[0]!.body.items).toEqual([])
    })

    it('branch 가 하나도 없어도 파싱된다: case hi in esac', () => {
      const cmd = parse('case hi in esac').items[0]!.pipeline.commands[0]!
      if (cmd.kind !== 'case') throw new Error('expected case')
      expect(cmd.branches).toEqual([])
    })

    it('예약어는 명령 위치에서만 예약어다: echo case in esac 의 각 단어는 인자다', () => {
      const cmd = parse('echo case in esac').items[0]!.pipeline.commands[0]!
      expect(cmd.kind).toBe('command')
      if (cmd.kind !== 'command') throw new Error('expected command')
      expect(cmd.words).toEqual([raw('echo'), raw('case'), raw('in'), raw('esac')])
    })

    it('esac 없이 끝난 case 는 문법 오류다', () => {
      expect(() => parse('case hi in h*) echo H')).toThrow(/syntax error/)
    })

    it('멀티라인 case(패턴/본문/;;가 각각 다른 줄)는 한 줄 세미콜론 버전과 같은 AST 를 만든다', () => {
      expect(parse('case hi in\n  h*)\n    echo H\n    ;;\nesac')).toEqual(parse('case hi in h*) echo H;; esac'))
    })

    it('복합 명령도 파이프라인/리스트에 참여한다', () => {
      const ast = parse('case hi in h*) echo H;; esac | cat')
      expect(ast.items[0]!.pipeline.commands).toHaveLength(2)
      expect(ast.items[0]!.pipeline.commands[0]!.kind).toBe('case')
      expect(ast.items[0]!.pipeline.commands[1]!.kind).toBe('command')
    })

    it('case 밖의 bare `;;` 는 문법 오류다 (실제 bash와 일치, docker 확인)', () => {
      expect(() => parse('echo hi;; echo bye')).toThrow(/syntax error/)
    })
  })
})

describe('함수 정의 / 브레이스 그룹 (task 7)', () => {
  function firstCompound(input: string) {
    return parse(input).items[0]!.pipeline.commands[0]!
  }

  it('NAME() { LIST; } 를 funcdef 노드로 파싱한다', () => {
    const c = firstCompound('greet() { echo hi; }')
    expect(c.kind).toBe('funcdef')
    if (c.kind !== 'funcdef') throw new Error('not funcdef')
    expect(c.name).toBe('greet')
    expect(c.body.items).toHaveLength(1)
    expect(c.body.items[0]!.pipeline.commands[0]!.kind).toBe('command')
  })

  it('여러 () 스페이싱 형태가 모두 같은 funcdef AST 를 만든다', () => {
    const canonical = parse('f() { echo hi; }')
    expect(parse('f () { echo hi; }')).toEqual(canonical)
    expect(parse('f( ) { echo hi; }')).toEqual(canonical)
    expect(parse('f ( ) { echo hi; }')).toEqual(canonical)
  })

  it('function 예약어 형태(괄호 유무 둘 다)를 파싱한다', () => {
    const c1 = firstCompound('function hi { echo yo; }')
    expect(c1.kind).toBe('funcdef')
    if (c1.kind === 'funcdef') expect(c1.name).toBe('hi')
    const c2 = firstCompound('function hi() { echo yo; }')
    expect(c2.kind).toBe('funcdef')
    if (c2.kind === 'funcdef') expect(c2.name).toBe('hi')
  })

  it('멀티라인 함수 정의는 한 줄 버전과 같은 AST 다', () => {
    expect(parse('f() {\n  echo one\n  echo two\n}')).toEqual(parse('f() { echo one; echo two; }'))
  })

  it('{ LIST; } 를 group 노드로 파싱한다', () => {
    const c = firstCompound('{ echo a; echo b; }')
    expect(c.kind).toBe('group')
    if (c.kind !== 'group') throw new Error('not group')
    expect(c.body.items).toHaveLength(2)
  })

  it('body 브레이스가 없으면 문법 오류다', () => {
    expect(() => parse('f() echo hi')).toThrow(/syntax error/)
  })

  it('닫는 브레이스가 없으면 문법 오류다', () => {
    expect(() => parse('{ echo a')).toThrow(/syntax error/)
  })

  it('{echo (스페이스 없음) 는 그룹이 아니라 일반 명령이다', () => {
    // bash: `{echo` 는 예약어 `{` 가 아니라 명령 이름 `{echo` — 그룹이 아니다.
    const c = firstCompound('{echo hi; }')
    // 첫 단계는 group 이 아니라 명령(이름 `{echo`)이어야 한다.
    expect(c.kind).toBe('command')
  })

  it('funcdef/group 도 파이프라인/리스트에 참여한다', () => {
    const ast = parse('{ echo a; } | cat')
    expect(ast.items[0]!.pipeline.commands).toHaveLength(2)
    expect(ast.items[0]!.pipeline.commands[0]!.kind).toBe('group')
  })
})
