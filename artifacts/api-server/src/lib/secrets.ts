export function getOptionalSecret(name: string): string | undefined {
  const value = process.env[name];
  if (!value || value.trim() === "") return undefined;
  return value;
}

export function getRequiredSecret(name: string): string {
  const value = getOptionalSecret(name);
  if (!value) {
    throw new Error(`${name} is required and must be set in the environment.`);
  }
  return value;
}

export function getRequiredSecretFromAny(...names: string[]): string {
  for (const name of names) {
    const value = getOptionalSecret(name);
    if (value) return value;
  }

  throw new Error(`One of ${names.join(", ")} must be set in the environment.`);
}
