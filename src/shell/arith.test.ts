import { describe, it, expect } from 'vitest'
import { evalArith, ArithError } from './arith'

/**
 * 모든 기대값은 debian:stable-slim bash 5 로 실측 확인했다:
 *   docker run --rm debian:stable-slim bash -c 'echo $(( EXPR ))'
 * $(( )) 는 arithmetic context 라 `010`=8(8진), test/[ 의 10진 규칙과 다르다.
 */

const A = (expr: string, env: Record<string, string> = {}): number => evalArith(expr, { env })

describe('evalArith — 기본 산술', () => {
  it('덧셈/곱셈 우선순위', () => {
    expect(A('1+2')).toBe(3)
    expect(A('2*3+1')).toBe(7)
    expect(A('2+3*4')).toBe(14)
  })
  it('거듭제곱 ** (우결합)', () => {
    expect(A('2**10')).toBe(1024)
    expect(A('2**3**2')).toBe(512) // 2**(3**2) = 2**9
  })
  it('나눗셈은 0 방향 절삭, 나머지 부호는 피제수', () => {
    expect(A('10/3')).toBe(3)
    expect(A('7%3')).toBe(1)
    expect(A('-7/2')).toBe(-3)
    expect(A('-7%3')).toBe(-1)
    expect(A('7%-3')).toBe(1)
  })
  it('괄호', () => {
    expect(A('(1+2)*3')).toBe(9)
  })
  it('단항은 ** 보다 강하게 묶인다: -2**2 → (-2)**2 → 4', () => {
    expect(A('-2**2')).toBe(4)
    expect(A('-5')).toBe(-5)
    expect(A('- -5')).toBe(5)
    expect(A('+5')).toBe(5)
  })
})

describe('evalArith — 비교/논리/삼항', () => {
  it('비교는 1/0', () => {
    expect(A('5>3')).toBe(1)
    expect(A('5<3')).toBe(0)
    expect(A('5>=5')).toBe(1)
    expect(A('5<=4')).toBe(0)
    expect(A('3==3')).toBe(1)
    expect(A('3!=3')).toBe(0)
  })
  it('논리 && || 는 1/0', () => {
    expect(A('1&&0')).toBe(0)
    expect(A('0||5')).toBe(1)
    expect(A('5&&3')).toBe(1)
    expect(A('0||0')).toBe(0)
  })
  it('논리 부정 !', () => {
    expect(A('!0')).toBe(1)
    expect(A('!5')).toBe(0)
  })
  it('삼항 (우결합)', () => {
    expect(A('1?7:9')).toBe(7)
    expect(A('0?7:9')).toBe(9)
    expect(A('1?2:3?4:5')).toBe(2)
    expect(A('0?2:0?4:5')).toBe(5)
  })
})

describe('evalArith — 비트/시프트', () => {
  it('비트 not/and/or/xor', () => {
    expect(A('~0')).toBe(-1)
    expect(A('~5')).toBe(-6)
    expect(A('12&10')).toBe(8)
    expect(A('1|2&3')).toBe(3) // & 가 | 보다 강하다
    expect(A('1^2|4')).toBe(7)
  })
  it('시프트', () => {
    expect(A('1<<4')).toBe(16)
    expect(A('255>>4')).toBe(15)
  })
})

describe('evalArith — 리터럴 진법', () => {
  it('8진(선행 0), 16진(0x/0X)', () => {
    expect(A('010')).toBe(8)
    expect(A('017')).toBe(15)
    expect(A('0x1f')).toBe(31)
    expect(A('0X1F')).toBe(31)
    expect(A('0xff')).toBe(255)
    expect(A('0')).toBe(0)
  })
  it('잘못된 8진 08 은 던진다', () => {
    expect(() => A('08')).toThrow(ArithError)
  })
})

describe('evalArith — 변수 읽기', () => {
  it('bare 식별자', () => {
    expect(A('x+1', { x: '5' })).toBe(6)
  })
  it('$x 형태도 읽는다', () => {
    expect(A('$x*2', { x: '5' })).toBe(10)
  })
  it('미설정/빈 변수는 0', () => {
    expect(A('y+1')).toBe(1)
    expect(A('z+5', { z: '' })).toBe(5)
  })
  it('변수 값이 산술식이면 재귀 평가한다', () => {
    expect(A('x', { x: 'y+1', y: '2' })).toBe(3)
    expect(A('x', { x: 'hello' })).toBe(0) // hello 는 미설정 변수 → 0
  })
  it('순환 참조는 던진다(무한 재귀 방지)', () => {
    expect(() => A('x', { x: 'x' })).toThrow(ArithError)
    expect(() => A('a', { a: 'b', b: 'a' })).toThrow(ArithError)
  })
})

describe('evalArith — 대입 부작용', () => {
  it('= 는 값을 반환하고 env 를 바꾼다', () => {
    const env = { x: '3' }
    expect(evalArith('x=x+2', { env })).toBe(5)
    expect(env.x).toBe('5')
  })
  it('복합 대입 += -= *= /= %=', () => {
    const env: Record<string, string> = { x: '5' }
    expect(evalArith('x+=10', { env })).toBe(15)
    expect(env.x).toBe('15')
    expect(evalArith('x-=5', { env })).toBe(10)
    expect(evalArith('x*=3', { env })).toBe(30)
    expect(evalArith('x/=4', { env })).toBe(7)
    expect(evalArith('x%=5', { env })).toBe(2)
    expect(env.x).toBe('2')
  })
  it('비트 복합 대입 &= |= ^= <<= >>=', () => {
    const env: Record<string, string> = { x: '12' }
    expect(evalArith('x&=10', { env })).toBe(8)
    expect(evalArith('x|=1', { env })).toBe(9)
    expect(evalArith('x^=8', { env })).toBe(1)
    expect(evalArith('x<<=4', { env })).toBe(16)
    expect(evalArith('x>>=2', { env })).toBe(4)
    expect(env.x).toBe('4')
  })
  it('대입 우결합', () => {
    const env: Record<string, string> = {}
    expect(evalArith('a=b=5', { env })).toBe(5)
    expect(env.a).toBe('5')
    expect(env.b).toBe('5')
  })
  it('비변수에 대입하면 던진다', () => {
    expect(() => A('5=3')).toThrow(ArithError)
  })
})

describe('evalArith — 증감', () => {
  it('후위 x++ 은 옛 값 반환, env 는 +1', () => {
    const env = { x: '3' }
    expect(evalArith('x++', { env })).toBe(3)
    expect(env.x).toBe('4')
  })
  it('전위 ++x 는 새 값 반환, env 도 +1', () => {
    const env = { x: '3' }
    expect(evalArith('++x', { env })).toBe(4)
    expect(env.x).toBe('4')
  })
  it('x-- 후위, --x 전위', () => {
    const env = { x: '3' }
    expect(evalArith('x--', { env })).toBe(3)
    expect(env.x).toBe('2')
    expect(evalArith('--x', { env })).toBe(1)
    expect(env.x).toBe('1')
  })
  it('미설정 변수 증감은 0 에서 시작', () => {
    const env: Record<string, string> = {}
    expect(evalArith('x++', { env })).toBe(0)
    expect(env.x).toBe('1')
  })
})

describe('evalArith — 단락 평가와 부작용', () => {
  it('0 && (x=7) 은 x 를 건드리지 않는다', () => {
    const env: Record<string, string> = {}
    expect(evalArith('0&&(x=7)', { env })).toBe(0)
    expect(env.x).toBeUndefined()
  })
  it('1 || (x=7) 은 x 를 건드리지 않는다', () => {
    const env: Record<string, string> = {}
    expect(evalArith('1||(x=7)', { env })).toBe(1)
    expect(env.x).toBeUndefined()
  })
  it('삼항은 취한 가지만 평가한다', () => {
    const env: Record<string, string> = {}
    expect(evalArith('0?(a=5):(a=9)', { env })).toBe(9)
    expect(env.a).toBe('9')
  })
})

describe('evalArith — 오류', () => {
  it('0 나누기는 던진다', () => {
    expect(() => A('1/0')).toThrow(ArithError)
    expect(() => A('5%0')).toThrow(ArithError)
  })
  it('음수 지수는 던진다', () => {
    expect(() => A('2**-1')).toThrow(ArithError)
  })
  it('문법 오류는 던진다', () => {
    expect(() => A('1+')).toThrow(ArithError)
    expect(() => A('1 2')).toThrow(ArithError)
    expect(() => A('(1+2')).toThrow(ArithError)
  })
  it('빈 식은 0 (bash: $(()) → 0)', () => {
    expect(A('')).toBe(0)
    expect(A('   ')).toBe(0)
  })
})
