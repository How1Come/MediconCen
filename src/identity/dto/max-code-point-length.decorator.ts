import { ValidateBy } from 'class-validator';

export function MaxCodePointLength(max: number): PropertyDecorator {
  return ValidateBy({
    name: 'maxCodePointLength',
    constraints: [max],
    validator: {
      validate: (value: unknown): boolean =>
        typeof value === 'string' && Array.from(value).length <= max,
      defaultMessage: () =>
        '$property must contain at most $constraint1 Unicode characters',
    },
  });
}
