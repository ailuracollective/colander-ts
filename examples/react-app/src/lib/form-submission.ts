/** Keep rule evaluation ahead of validation; a null result falls back to local answers. */
export async function runEvaluationThenValidation(
  evaluate: () => Promise<Record<string, unknown> | null>,
  validate: (answers: Record<string, unknown>) => Promise<void>,
  getFallbackAnswers: () => Record<string, unknown>,
): Promise<void> {
  const evaluatedAnswers = await evaluate();
  await validate(evaluatedAnswers ?? getFallbackAnswers());
}
