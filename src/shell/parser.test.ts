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
})
