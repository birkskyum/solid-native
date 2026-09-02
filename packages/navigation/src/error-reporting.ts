/**
 * Invokes an application diagnostic hook without allowing either a thrown
 * error or a rejected return value to replace the failure being reported.
 */
export function reportIsolatedError<TArguments extends readonly unknown[]>(
  handler: ((...arguments_: TArguments) => unknown) | undefined,
  ...arguments_: TArguments
): boolean {
  if (handler === undefined) return false;
  try {
    const reported = handler(...arguments_);
    void Promise.resolve(reported).catch(() => undefined);
  } catch {
    // Diagnostic hooks are observers, not a second application failure path.
  }
  return true;
}
