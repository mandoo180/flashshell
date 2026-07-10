import { describe, it, expect } from 'vitest'
import { parse } from './parser'

const raw = (text: string) => [{ kind: 'raw' as const, text }]

describe('parse', () => {
  it('단일 명령을 파싱한다', () => {
    const ast = parse('ls -a')
    expect(ast.items).toHaveLength(1)
    expect(ast.items[0]!.op).toBeNull()
    const cmd = ast.items[0]!.pipeline.commands[0]!
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
    const cmd = parse('echo hi > out.txt').items[0]!.pipeline.commands[0]!
    expect(cmd.redirs).toEqual([{ fd: 1, op: '>', target: raw('out.txt') }])
    expect(cmd.words).toEqual([raw('echo'), raw('hi')])
  })

  it('추가 리다이렉션 >>', () => {
    const cmd = parse('echo hi >> out').items[0]!.pipeline.commands[0]!
    expect(cmd.redirs[0]).toEqual({ fd: 1, op: '>>', target: raw('out') })
  })

  it('입력 리다이렉션을 fd 0으로 기록한다', () => {
    const cmd = parse('wc -l < in').items[0]!.pipeline.commands[0]!
    expect(cmd.redirs[0]).toEqual({ fd: 0, op: '<', target: raw('in') })
  })

  it('2> 와 2>> 를 fd 2로 기록한다', () => {
    expect(parse('cmd 2> e').items[0]!.pipeline.commands[0]!.redirs[0])
      .toEqual({ fd: 2, op: '>', target: raw('e') })
    expect(parse('cmd 2>> e').items[0]!.pipeline.commands[0]!.redirs[0])
      .toEqual({ fd: 2, op: '>>', target: raw('e') })
  })

  it('리다이렉션이 명령 중간에 와도 된다', () => {
    const cmd = parse('echo > out hi').items[0]!.pipeline.commands[0]!
    expect(cmd.words).toEqual([raw('echo'), raw('hi')])
    expect(cmd.redirs).toHaveLength(1)
  })

  it('여러 리다이렉션을 순서대로 모은다', () => {
    const cmd = parse('cmd > o 2> e < i').items[0]!.pipeline.commands[0]!
    expect(cmd.redirs.map((r) => r.fd)).toEqual([1, 2, 0])
  })

  it('선행 변수 대입을 분리한다', () => {
    const cmd = parse('FOO=bar ls').items[0]!.pipeline.commands[0]!
    expect(cmd.assignments).toEqual([{ name: 'FOO', value: raw('bar') }])
    expect(cmd.words).toEqual([raw('ls')])
  })

  it('명령 없는 순수 대입도 파싱한다', () => {
    const cmd = parse('X=1').items[0]!.pipeline.commands[0]!
    expect(cmd.assignments).toHaveLength(1)
    expect(cmd.words).toEqual([])
  })

  it('명령 뒤에 오는 FOO=bar 는 대입이 아니라 인자다', () => {
    const cmd = parse('echo FOO=bar').items[0]!.pipeline.commands[0]!
    expect(cmd.assignments).toEqual([])
    expect(cmd.words).toHaveLength(2)
  })

  it('따옴표 붙은 FOO 는 대입이 아니다', () => {
    const cmd = parse(`'FOO'=bar`).items[0]!.pipeline.commands[0]!
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
    const cmd = parse('> out').items[0]!.pipeline.commands[0]!
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
    const cmd = parse('X="a b"').items[0]!.pipeline.commands[0]!
    expect(cmd.assignments).toEqual([{ name: 'X', value: [{ kind: 'dquote', text: 'a b' }] }])
  })

  it("X='a b' 는 대입이고 값은 literal 조각을 그대로 보존한다", () => {
    const cmd = parse("X='a b'").items[0]!.pipeline.commands[0]!
    expect(cmd.assignments).toEqual([{ name: 'X', value: [{ kind: 'literal', text: 'a b' }] }])
  })

  it('X=a"b"c 는 raw/dquote/raw 세 조각이 순서대로 남는다', () => {
    const cmd = parse('X=a"b"c').items[0]!.pipeline.commands[0]!
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
    const cmd = parse('X=').items[0]!.pipeline.commands[0]!
    expect(cmd.assignments).toEqual([{ name: 'X', value: [] }])
  })

  it('X=a=b 는 첫 = 에서만 나뉜다', () => {
    const cmd = parse('X=a=b').items[0]!.pipeline.commands[0]!
    expect(cmd.assignments).toEqual([{ name: 'X', value: raw('a=b') }])
  })

  it('FOO"BAR"=baz 는 이름 중간에 따옴표가 있어 대입이 아니라 명령이다', () => {
    const cmd = parse('FOO"BAR"=baz').items[0]!.pipeline.commands[0]!
    expect(cmd.assignments).toEqual([])
    expect(cmd.words).toHaveLength(1)
  })

  it('여러 선행 대입을 모두 모은다', () => {
    const cmd = parse('FOO=bar BAZ=qux echo hi').items[0]!.pipeline.commands[0]!
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
      expect(ast.items[0]!.pipeline.commands[0]!.words).toEqual([raw('mkdir'), raw('a')])
      expect(ast.items[1]!.pipeline.commands[0]!.words).toEqual([raw('mkdir'), raw('b')])
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
})
