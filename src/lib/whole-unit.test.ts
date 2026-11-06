import { describe, expect, it } from 'vitest';
import { equilibriumScore, evaluatePurchases, scoreLabel, wholeUnitProposal } from './whole-unit';
import { type Position } from './portfolio';

const positions: Position[] = [
  { id: 'a', name: 'A', isin: 'A', quantity: 10, price: 100, priceDate: '2026-11-06', target: 50 },
  { id: 'b', name: 'B', isin: 'B', quantity: 0, price: 75, priceDate: '2026-11-06', target: 50 },
];

describe('whole-unit recommendations', () => {
  it('buys only nonnegative whole units and never exceeds a custom budget', () => {
    for (const budget of [0, 50, 75, 200, 1000, 23456]) {
      const r = wholeUnitProposal(positions, budget, 'budget');
      expect(r.spent).toBeLessThanOrEqual(budget + 1e-8);
      expect(r.spent + r.cash).toBeCloseTo(budget, 6);
      r.lines.forEach((line, i) => {
        expect(Number.isInteger(line.shares)).toBe(true);
        expect(line.shares).toBeGreaterThanOrEqual(0);
        expect(line.projectedQuantity).toBeGreaterThanOrEqual(positions[i]?.quantity ?? 0);
      });
    }
  });
  it('leaves cash when no whole unit is affordable', () => {
    const r = wholeUnitProposal(positions, 50, 'budget');
    expect(r.units).toEqual([0, 0]); expect(r.cash).toBe(50);
  });
  it('keeps the theoretical minimum separate from the whole-unit target search', () => {
    const r = wholeUnitProposal(positions, 50, 'target');
    expect(r.theoreticalMinimum).toBe(1000);
    expect(r.limit).toBe(1175);
    expect(r.units).toEqual([0, 13]);
    expect(r.spent).toBe(975); expect(r.toleranceReached).toBe(false);
  });
  it('finds the least spending reaching the 0.05 pp tolerance in the examined range', () => {
    const r = wholeUnitProposal(positions.map(p => ({ ...p, price: 100 })), 0, 'target');
    expect(r.units).toEqual([0, 10]); expect(r.spent).toBe(1000);
    expect(r.toleranceReached).toBe(true); expect(r.maxGap).toBe(0);
  });
  it('recalculates edits and rejection without changing holdings', () => {
    const original = structuredClone(positions);
    const edited = evaluatePurchases(positions, [0, 2], 200);
    expect(edited.spent).toBe(150); expect(edited.cash).toBe(50);
    expect(edited.lines[1]?.projectedQuantity).toBe(2);
    expect(edited.lines[1]?.finalWeight).toBeCloseTo(150 / 1150 * 100);
    expect(evaluatePurchases(positions, [0, 0], 200).cash).toBe(200);
    expect(positions).toEqual(original);
  });
  it('refuses overspending, negative and fractional purchase edits', () => {
    expect(() => evaluatePurchases(positions, [0, 3], 200)).toThrow();
    expect(() => evaluatePurchases(positions, [0, -1], 200)).toThrow();
    expect(() => evaluatePurchases(positions, [0, 1.5], 200)).toThrow();
  });
  it('requires 100 percent targets and dated prices', () => {
    expect(wholeUnitProposal(positions.map(p => ({ ...p, target: 49 })), 200, 'budget').valid).toBe(false);
    expect(wholeUnitProposal(positions.map(p => ({ ...p, price: null, priceDate: null })), 200, 'budget').valid).toBe(false);
    expect(wholeUnitProposal(positions.map(p => ({ ...p, priceDate: null })), 200, 'budget').valid).toBe(false);
  });
  it('signals a held zero-target position as impossible without sale', () => {
    const r = wholeUnitProposal(positions.map((p, i) => ({ ...p, target: i === 0 ? 0 : 100 })), 500, 'target');
    expect(r.theoreticalMinimum).toBe(Infinity);
    expect(r.continuous.impossibleWithoutSale).toBe(true);
    expect(r.units).toEqual([0, 0]); expect(r.toleranceReached).toBe(false);
  });
  it('scores balance on a transparent 0–100 scale', () => {
    expect(equilibriumScore([50, 50], [50, 50])).toBe(100);
    expect(equilibriumScore([100, 0], [50, 50])).toBe(50);
    expect(equilibriumScore([100, 0], [0, 100])).toBe(0);
    expect(equilibriumScore([0, 0], [50, 50])).toBeNull();
    const r = evaluatePurchases(positions, [0, 10], 1000);
    expect(r.currentScore).toBe(50);
    expect(r.projectedScore).toBeCloseTo(92.857142857);
  });
  it('classifies scores of 90–100 as Excellent', () => {
    expect(scoreLabel(90)).toBe('Excellent'); expect(scoreLabel(100)).toBe('Excellent');
  });
  it('classifies scores from 75 to below 90 as Good', () => {
    expect(scoreLabel(75)).toBe('Bon'); expect(scoreLabel(89.99)).toBe('Bon');
  });
  it('classifies scores from 50 to below 75 as Moderate', () => {
    expect(scoreLabel(50)).toBe('Modéré'); expect(scoreLabel(74.99)).toBe('Modéré');
  });
  it('classifies scores below 50 as significant imbalance', () => {
    expect(scoreLabel(49.99)).toBe('Déséquilibre important');
    expect(scoreLabel(0)).toBe('Déséquilibre important');
  });
});