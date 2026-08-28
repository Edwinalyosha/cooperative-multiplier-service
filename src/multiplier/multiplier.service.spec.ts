import { ConfigService } from '@nestjs/config';
import { MultiplierService } from './multiplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { FineractService } from '../fineract/fineract.service';
import { MAX_LOAN_AMOUNT, DEFAULT_MULTIPLIER } from './multiplier.constants';
import { selectLoanTier } from '../loans/loan-tiers.constants';

/**
 * Covers the pure money-math on MultiplierService: the curve that turns a
 * director's multiplier into a loan multiple, and the multiple into a
 * borrowing limit.
 *
 * These are deliberately instantiated by hand rather than through
 * Test.createTestingModule — none of the methods under test touch prisma,
 * Fineract, or config, so a DI harness would only add failure modes that
 * have nothing to do with the arithmetic.
 *
 * Written 2026-08-24. This logic previously had NO coverage at all: the
 * file that used to sit here was an unmodified Nest CLI scaffold whose only
 * assertion was `expect(service).toBeDefined()`.
 */
describe('MultiplierService — loan eligibility math', () => {
  let service: MultiplierService;

  beforeEach(() => {
    service = new MultiplierService(
      {} as PrismaService,
      {} as FineractService,
      { get: () => undefined } as unknown as ConfigService,
    );
  });

  describe('clampMultiplier', () => {
    // 0.6 is the best achievable rate, 1.5 the worst. Nothing may escape
    // that band: the loan-multiple curve below divides by (1.5 - 0.6) and
    // takes a fractional power, so an out-of-band value would produce NaN
    // and silently poison every downstream limit.
    it('clamps to the 0.6 – 1.5 band', () => {
      expect(service.clampMultiplier(0.1)).toBe(0.6);
      expect(service.clampMultiplier(9.9)).toBe(1.5);
    });

    it('leaves in-band values untouched', () => {
      expect(service.clampMultiplier(0.6)).toBe(0.6);
      expect(service.clampMultiplier(1.0)).toBe(1.0);
      expect(service.clampMultiplier(1.5)).toBe(1.5);
    });
  });

  describe('calculateLoanMultiple', () => {
    it('gives the maximum 5x multiple at the best multiplier (0.6)', () => {
      expect(service.calculateLoanMultiple(0.6)).toBe(5);
    });

    it('gives the minimum 1x multiple at the worst multiplier (1.5)', () => {
      expect(service.calculateLoanMultiple(1.5)).toBe(1);
    });

    // Locks in the value observed in production: DirectorMultiplier rows for
    // clientId 1 and 2 both carry loanMultiple 2.189 at the default
    // multiplier. If the curve constants are ever retuned, this fails and
    // forces an explicit decision rather than silently repricing every
    // member's borrowing limit.
    it('matches production: default multiplier 1.000 -> 2.189x', () => {
      expect(service.calculateLoanMultiple(DEFAULT_MULTIPLIER)).toBe(2.189);
    });

    it('is monotonically decreasing — a worse multiplier never lends more', () => {
      const samples = [0.6, 0.8, 1.0, 1.2, 1.5];
      const multiples = samples.map((m) => service.calculateLoanMultiple(m));
      for (let i = 1; i < multiples.length; i++) {
        expect(multiples[i]).toBeLessThan(multiples[i - 1]);
      }
    });

    it('clamps before computing, so out-of-band input never yields NaN', () => {
      expect(service.calculateLoanMultiple(-5)).toBe(5);
      expect(service.calculateLoanMultiple(99)).toBe(1);
    });
  });

  describe('calculateMaxLoanAmount', () => {
    // Both figures verified against the live database 2026-08-24.
    it('matches production for clientId 2 (50,000 x 2.189)', () => {
      expect(service.calculateMaxLoanAmount(50_000, 2.189)).toEqual({
        maxLoanAmount: 109_450,
        cappedAtMax: false,
      });
    });

    it('matches production for clientId 1 (80,190.92 x 2.189)', () => {
      const { maxLoanAmount } = service.calculateMaxLoanAmount(
        80_190.92,
        2.189,
      );
      expect(maxLoanAmount).toBe(175_537);
    });

    it('floors rather than rounds — never offers a shilling not earned', () => {
      expect(service.calculateMaxLoanAmount(100.9, 1).maxLoanAmount).toBe(100);
    });

    it('caps at MAX_LOAN_AMOUNT and flags it', () => {
      const result = service.calculateMaxLoanAmount(10_000_000, 5);
      expect(result.maxLoanAmount).toBe(MAX_LOAN_AMOUNT);
      expect(result.cappedAtMax).toBe(true);
    });

    it('does not flag cappedAtMax when exactly at the cap', () => {
      const result = service.calculateMaxLoanAmount(MAX_LOAN_AMOUNT, 1);
      expect(result.maxLoanAmount).toBe(MAX_LOAN_AMOUNT);
      expect(result.cappedAtMax).toBe(false);
    });

    it('handles a zero balance without dividing or throwing', () => {
      expect(service.calculateMaxLoanAmount(0, 2.189)).toEqual({
        maxLoanAmount: 0,
        cappedAtMax: false,
      });
    });
  });

  describe('borrowing-limit ceiling', () => {
    // The highest limit ANY member can ever reach: best possible multiplier
    // (0.6 -> 5x) against an unbounded balance.
    //
    // MAX_LOAN_AMOUNT is now DERIVED from the loan tiers rather than being an
    // independent number — see loan-tiers.constants.ts. It is deliberately
    // not asserted against a literal here: pinning it would just duplicate
    // the tier table and start the same drift that left Tier 3 unreachable.
    // loan-tiers.constants.spec.ts owns the structural guarantees.
    it('can never exceed MAX_LOAN_AMOUNT regardless of balance or multiple', () => {
      const bestMultiple = service.calculateLoanMultiple(0.6);
      const { maxLoanAmount } = service.calculateMaxLoanAmount(
        Number.MAX_SAFE_INTEGER,
        bestMultiple,
      );
      expect(maxLoanAmount).toBe(MAX_LOAN_AMOUNT);
    });

    it('the cap is reachable by a real tier, so a capped member can borrow', () => {
      // If the cap ever exceeded every tier's maximum, a member whose
      // eligibility was capped would be quoted a limit they could not
      // actually apply for.
      expect(selectLoanTier(MAX_LOAN_AMOUNT)).not.toBeNull();
    });
  });
});
