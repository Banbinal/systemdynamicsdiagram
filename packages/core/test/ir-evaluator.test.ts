/**
 * IR evaluator: arithmetic, comparison, logical, and built-in dispatch.
 */

import { describe, expect, it } from 'vitest';

import { evalOps } from '../src/ir/evaluator.js';
import type { Op } from '../src/ir/op.js';
import type { MapData } from '../src/ir/program.js';

function ctx(opts: {
  constants?: number[];
  stocks?: number[];
  calcs?: number[];
  time?: number;
  maps?: MapData[];
} = {}) {
  return {
    constants: new Float64Array(opts.constants ?? []),
    stocks: new Float64Array(opts.stocks ?? []),
    calcs: new Float64Array(opts.calcs ?? []),
    time: opts.time ?? 0,
    maps: opts.maps ?? [],
  };
}

const STACK = new Float64Array(32);

describe('evaluator — push and load', () => {
  it('pushes a literal', () => {
    const ops: Op[] = [{ kind: 'PushNum', value: 42 }];
    expect(evalOps(ops, ctx(), STACK)).toBe(42);
  });

  it('loads a constant slot', () => {
    const ops: Op[] = [{ kind: 'LoadConstant', slot: 1 }];
    expect(evalOps(ops, ctx({ constants: [10, 20, 30] }), STACK)).toBe(20);
  });

  it('loads a stock slot', () => {
    const ops: Op[] = [{ kind: 'LoadStock', slot: 0 }];
    expect(evalOps(ops, ctx({ stocks: [99] }), STACK)).toBe(99);
  });

  it('loads a calc slot', () => {
    const ops: Op[] = [{ kind: 'LoadCalc', slot: 2 }];
    expect(evalOps(ops, ctx({ calcs: [1, 2, 3] }), STACK)).toBe(3);
  });

  it('loads time', () => {
    const ops: Op[] = [{ kind: 'LoadTime' }];
    expect(evalOps(ops, ctx({ time: 5.5 }), STACK)).toBe(5.5);
  });
});

describe('evaluator — unary', () => {
  it('negates', () => {
    const ops: Op[] = [{ kind: 'PushNum', value: 7 }, { kind: 'UnOp', op: '-' }];
    expect(evalOps(ops, ctx(), STACK)).toBe(-7);
  });
  it('passes through unary +', () => {
    const ops: Op[] = [{ kind: 'PushNum', value: 7 }, { kind: 'UnOp', op: '+' }];
    expect(evalOps(ops, ctx(), STACK)).toBe(7);
  });
  it('logical NOT: 0 → 1', () => {
    const ops: Op[] = [{ kind: 'PushNum', value: 0 }, { kind: 'UnOp', op: '!' }];
    expect(evalOps(ops, ctx(), STACK)).toBe(1);
  });
  it('logical NOT: nonzero → 0', () => {
    const ops: Op[] = [{ kind: 'PushNum', value: 3 }, { kind: 'UnOp', op: '!' }];
    expect(evalOps(ops, ctx(), STACK)).toBe(0);
  });
});

describe('evaluator — binary arithmetic', () => {
  function bin(op: '+' | '-' | '*' | '/' | '%' | '^', a: number, b: number): number {
    return evalOps(
      [
        { kind: 'PushNum', value: a },
        { kind: 'PushNum', value: b },
        { kind: 'BinOp', op },
      ],
      ctx(),
      STACK,
    );
  }
  it('+', () => expect(bin('+', 3, 4)).toBe(7));
  it('-', () => expect(bin('-', 10, 6)).toBe(4));
  it('*', () => expect(bin('*', 6, 7)).toBe(42));
  it('/', () => expect(bin('/', 22, 4)).toBe(5.5));
  it('% (positive)', () => expect(bin('%', 10, 3)).toBe(1));
  it('^', () => expect(bin('^', 2, 10)).toBe(1024));
  it('division by zero produces ±Infinity, not throw', () => {
    expect(bin('/', 1, 0)).toBe(Infinity);
    expect(bin('/', -1, 0)).toBe(-Infinity);
  });
  it('0/0 is NaN', () => {
    expect(Number.isNaN(bin('/', 0, 0))).toBe(true);
  });
});

describe('evaluator — comparison and logical', () => {
  function bin(
    op: '<' | '<=' | '>' | '>=' | '==' | '!=' | '&&' | '||',
    a: number,
    b: number,
  ): number {
    return evalOps(
      [
        { kind: 'PushNum', value: a },
        { kind: 'PushNum', value: b },
        { kind: 'BinOp', op },
      ],
      ctx(),
      STACK,
    );
  }
  it('< returns 1/0', () => {
    expect(bin('<', 3, 5)).toBe(1);
    expect(bin('<', 5, 3)).toBe(0);
    expect(bin('<', 5, 5)).toBe(0);
  });
  it('<=', () => {
    expect(bin('<=', 5, 5)).toBe(1);
    expect(bin('<=', 6, 5)).toBe(0);
  });
  it('==', () => {
    expect(bin('==', 1, 1)).toBe(1);
    expect(bin('==', 1, 2)).toBe(0);
  });
  it('&& truthiness', () => {
    expect(bin('&&', 1, 1)).toBe(1);
    expect(bin('&&', 0, 1)).toBe(0);
    expect(bin('&&', 1, 0)).toBe(0);
  });
  it('|| truthiness', () => {
    expect(bin('||', 0, 0)).toBe(0);
    expect(bin('||', 0, 1)).toBe(1);
    expect(bin('||', 1, 0)).toBe(1);
  });
});

describe('evaluator — built-ins', () => {
  function call(name: string, args: number[], time = 0): number {
    const ops: Op[] = [
      ...args.map((v): Op => ({ kind: 'PushNum', value: v })),
      { kind: 'CallBuiltin', name, argc: args.length },
    ];
    return evalOps(ops, ctx({ time }), STACK);
  }

  it('abs', () => {
    expect(call('abs', [-3])).toBe(3);
    expect(call('abs', [3])).toBe(3);
  });
  it('sqrt', () => expect(call('sqrt', [9])).toBe(3));
  it('exp(0) = 1', () => expect(call('exp', [0])).toBe(1));
  it('log(e) = 1', () => expect(call('log', [Math.E])).toBeCloseTo(1, 12));
  it('log10(1000) = 3', () => expect(call('log10', [1000])).toBeCloseTo(3, 12));
  it('sin(0) = 0', () => expect(call('sin', [0])).toBe(0));
  it('cos(0) = 1', () => expect(call('cos', [0])).toBe(1));
  it('tan(0) = 0', () => expect(call('tan', [0])).toBe(0));
  it('min', () => expect(call('min', [3, 5])).toBe(3));
  it('max', () => expect(call('max', [3, 5])).toBe(5));
  it('pow', () => expect(call('pow', [2, 8])).toBe(256));

  it('step before t0 is 0', () => {
    expect(call('step', [10, 5], 4.99)).toBe(0);
  });
  it('step at and after t0 returns h', () => {
    expect(call('step', [10, 5], 5)).toBe(10);
    expect(call('step', [10, 5], 100)).toBe(10);
  });

  it('pulse outside [t0, t0+w) is 0', () => {
    expect(call('pulse', [10, 5, 2], 4.99)).toBe(0);
    expect(call('pulse', [10, 5, 2], 7)).toBe(0); // open interval at right
    expect(call('pulse', [10, 5, 2], 100)).toBe(0);
  });
  it('pulse inside [t0, t0+w) returns h', () => {
    expect(call('pulse', [10, 5, 2], 5)).toBe(10);
    expect(call('pulse', [10, 5, 2], 6.999)).toBe(10);
  });

  it('throws on a desugared builtin (smooth)', () => {
    expect(() =>
      evalOps(
        [
          { kind: 'PushNum', value: 1 },
          { kind: 'PushNum', value: 2 },
          { kind: 'CallBuiltin', name: 'smooth', argc: 2 },
        ],
        ctx(),
        STACK,
      ),
    ).toThrow(/smooth/);
  });
});

describe('evaluator — composite expressions', () => {
  it('evaluates a + b * c with precedence preserved by the IR', () => {
    // Equivalent of a + b * c with a=2, b=3, c=4:
    // PushNum 3, PushNum 4, BinOp *, PushNum 2, swap → easier to write as
    // PushNum 2, PushNum 3, PushNum 4, BinOp *, BinOp +
    const ops: Op[] = [
      { kind: 'PushNum', value: 2 },
      { kind: 'PushNum', value: 3 },
      { kind: 'PushNum', value: 4 },
      { kind: 'BinOp', op: '*' },
      { kind: 'BinOp', op: '+' },
    ];
    expect(evalOps(ops, ctx(), STACK)).toBe(14);
  });

  it('evaluates a constant minus a calc', () => {
    const ops: Op[] = [
      { kind: 'LoadConstant', slot: 0 },
      { kind: 'LoadCalc', slot: 0 },
      { kind: 'BinOp', op: '-' },
    ];
    expect(evalOps(ops, ctx({ constants: [10], calcs: [3] }), STACK)).toBe(7);
  });
});
