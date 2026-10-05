// What a coach is paid for a period.
//
// An Outcome coach: 300 for each session held, and 250 for each of their
// graduates who did not use a purchased service (a programme client account).
// A Support coach: 500 for each session held. Each session is paid at the
// coach's type in that session's group, so a coach who is Outcome in one
// group and Support in another is paid each rate where it applies. Any other
// type has no rate and is shown as such. Amounts are in Egyptian pounds.

export const coachRates = { "Outcome Coach": 300, "Support Coach": 500 } as const;
export const outcomeGraduateBonus = 250;

export function coachPayout(sessionTypes: string[], graduatesWithoutPurchases: number) {
  const sessionsPay = sessionTypes.reduce((n, type) => n + ((coachRates as Record<string, number>)[type] || 0), 0);
  const outcome = sessionTypes.includes("Outcome Coach");
  const bonus = outcome ? graduatesWithoutPurchases * outcomeGraduateBonus : 0;
  return { sessionsPay, bonus, total: sessionsPay + bonus, unpaidSessions: sessionTypes.filter((t) => !(t in coachRates)).length };
}
