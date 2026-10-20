import { describe, expect, it } from 'vitest';
import {
  createTimer, formatClock, formatDuration, ingredientsForStep, parseStepTimers, pauseTimer, resetTimer, secondsLeft, startTimer, tickTimers,
} from '../../src/cooking/index';

const secs = (t: string) => parseStepTimers(t).map((x) => x.seconds);

describe('parseStepTimers', () => {
  it('reads plain minutes, hours and seconds', () => {
    expect(secs('Simmer for 20 minutes.')).toEqual([1200]);
    expect(secs('Roast for 1 hour.')).toEqual([3600]);
    expect(secs('Rest for 45 seconds')).toEqual([45]);
    expect(secs('Cook 5 mins')).toEqual([300]);
    expect(secs('Bake 20min')).toEqual([1200]);
  });
  it('reads ranges using the lower bound and keeps the upper', () => {
    const [t] = parseStepTimers('Fry for 10-12 mins until golden.');
    expect(t).toMatchObject({ seconds: 600, maxSeconds: 720 });
    expect(secs('Simmer 2 to 3 minutes')).toEqual([120]);
    expect(secs('Cook 10–15 minutes')).toEqual([600]);
  });
  it('reads compound, fractional and worded durations', () => {
    expect(secs('Slow cook for 1 hour 30 minutes')).toEqual([5400]);
    expect(secs('Bake 1½ hours')).toEqual([5400]);
    expect(secs('Leave for half an hour')).toEqual([1800]);
    expect(secs('Chill for an hour')).toEqual([3600]);
    expect(secs('Boil for five minutes')).toEqual([300]);
  });
  it('finds several in one step, in order', () => {
    expect(secs('Sear 2 minutes each side, then rest for 5 minutes.')).toEqual([120, 300]);
  });
  it('ignores non-durations', () => {
    expect(secs('Add 200 g flour and 2 tbsp oil.')).toEqual([]);
    expect(secs('Preheat the oven to 180 C.')).toEqual([]);
    expect(secs('Cook for 0 minutes')).toEqual([]);
    expect(secs('Marinate for 48 hours')).toEqual([]);
  });
  it('labels', () => {
    expect(parseStepTimers('simmer for 20 minutes')[0]!.label).toBe('20 min');
    expect(parseStepTimers('1 hour 30 minutes')[0]!.label).toBe('1 h 30 min');
    expect(parseStepTimers('10-12 mins')[0]!.label).toBe('10-12 min');
    expect(formatDuration(125)).toBe('2 min 5 sec');
    expect(formatClock(75)).toBe('1:15');
    expect(formatClock(3725)).toBe('1:02:05');
  });
});

describe('timer state machine', () => {
  it('runs, pauses with the remainder, resumes, finishes once and resets', () => {
    let t = createTimer('a', 'Pasta', 600, 2);
    expect(secondsLeft(t, 0)).toBe(600);
    t = startTimer(t, 1000);
    expect(secondsLeft(t, 1000 + 100_000)).toBe(500);
    t = pauseTimer(t, 1000 + 100_000);
    expect(t).toMatchObject({ status: 'paused', remainingSeconds: 500, endsAt: null });
    expect(secondsLeft(t, 9_999_999)).toBe(500);
    t = startTimer(t, 200_000);
    expect(t.endsAt).toBe(200_000 + 500_000);
    let r = tickTimers([t], 600_000);
    expect(r.finished).toHaveLength(0);
    expect(r.timers[0]).toBe(t);
    r = tickTimers([t], 700_000);
    expect(r.finished.map((x) => x.id)).toEqual(['a']);
    expect(r.timers[0]).toMatchObject({ status: 'done', alerted: true });
    expect(tickTimers(r.timers, 800_000).finished).toHaveLength(0);
    expect(startTimer(r.timers[0]!, 900_000)).toMatchObject({ status: 'running', remainingSeconds: 600 });
    expect(resetTimer(r.timers[0]!)).toMatchObject({ status: 'idle', remainingSeconds: 600, alerted: false });
  });
  it('runs several at once independently', () => {
    const a = startTimer(createTimer('a', 'A', 60), 0);
    const b = startTimer(createTimer('b', 'B', 120), 0);
    const r = tickTimers([a, b], 61_000);
    expect(r.finished.map((x) => x.id)).toEqual(['a']);
    expect(r.timers.map((x) => x.status)).toEqual(['done', 'running']);
  });
});

describe('ingredientsForStep', () => {
  const ings = [
    { id: '1', name: 'onion' }, { id: '2', name: 'tinned chopped tomatoes' }, { id: '3', name: 'olive oil' },
    { id: '4', name: 'fresh basil' }, { id: '5', name: 'spaghetti' },
  ];
  it('matches by name, last word and plural', () => {
    expect(ingredientsForStep('Fry the onions gently.', ings).map((i) => i.id)).toEqual(['1']);
    expect(ingredientsForStep('Add the tomatoes and simmer.', ings).map((i) => i.id)).toEqual(['2']);
    expect(ingredientsForStep('Heat the olive oil.', ings).map((i) => i.id)).toEqual(['3']);
    expect(ingredientsForStep('Tear in basil, toss the spaghetti.', ings).map((i) => i.id)).toEqual(['4', '5']);
  });
  it('finds nothing in a step that names no ingredient', () => {
    expect(ingredientsForStep('Leave to rest.', ings)).toEqual([]);
  });
});
