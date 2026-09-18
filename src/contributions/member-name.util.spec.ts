import { shortMemberName } from './member-name.util';

/**
 * Fineract's displayName is conventionally "Firstname Lastname" but is a
 * free-text field, so every shape below actually occurs. The cost of getting
 * it wrong is a finance manager recording money against the wrong person.
 */
describe('shortMemberName', () => {
  it('abbreviates the surname', () => {
    expect(shortMemberName('Mbarak Mohammed')).toBe('Mbarak M.');
  });

  it('leaves a single name whole', () => {
    // Do not invent an initial for a surname that was never given.
    expect(shortMemberName('Madonna')).toBe('Madonna');
  });

  it('uses the LAST name with three or more parts', () => {
    // The last part is the family name far more often than the middle one.
    expect(shortMemberName('Edwin Alyosha Ssekyondwa')).toBe('Edwin S.');
  });

  it('survives stray whitespace', () => {
    expect(shortMemberName('  Mbarak   Mohammed  ')).toBe('Mbarak M.');
  });

  it('uppercases the initial', () => {
    expect(shortMemberName('mbarak mohammed')).toBe('mbarak M.');
  });

  it('returns null when there is no name to show', () => {
    // Fineract being unreadable yields null, and the screen falls back to the
    // client id rather than rendering "undefined ." at someone.
    expect(shortMemberName(null)).toBeNull();
    expect(shortMemberName(undefined)).toBeNull();
    expect(shortMemberName('')).toBeNull();
    expect(shortMemberName('   ')).toBeNull();
  });
});
