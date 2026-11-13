import { z } from 'zod';
/** Prompt-side JSON Schema guidance. Zod remains the authoritative validator. */
export function jsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodNullable
  ) {
    const inner = jsonSchema(
      schema instanceof z.ZodDefault ? schema._def.innerType : schema.unwrap()
    );
    return schema instanceof z.ZodNullable ? { anyOf: [inner, { type: 'null' }] } : inner;
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    return {
      type: 'object',
      properties: Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, jsonSchema(v)])),
      required: Object.entries(shape)
        .filter(([, v]) => !v.isOptional())
        .map(([k]) => k),
      additionalProperties: false,
    };
  }
  if (schema instanceof z.ZodArray)
    return {
      type: 'array',
      items: jsonSchema(schema.element),
      ...(schema._def.minLength ? { minItems: schema._def.minLength.value } : {}),
      ...(schema._def.maxLength ? { maxItems: schema._def.maxLength.value } : {}),
    };
  if (schema instanceof z.ZodRecord)
    return { type: 'object', additionalProperties: jsonSchema(schema.valueSchema) };
  if (schema instanceof z.ZodDiscriminatedUnion || schema instanceof z.ZodUnion)
    return { anyOf: [...schema.options].map((s) => jsonSchema(s)) };
  if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema.options };
  if (schema instanceof z.ZodLiteral) return { const: schema.value };
  if (schema instanceof z.ZodString) {
    const result: Record<string, unknown> = { type: 'string' };
    for (const c of schema._def.checks) {
      if (c.kind === 'min') result.minLength = c.value;
      if (c.kind === 'max') result.maxLength = c.value;
      if (c.kind === 'regex') result.pattern = c.regex.source;
    }
    return result;
  }
  if (schema instanceof z.ZodNumber) {
    const result: Record<string, unknown> = { type: schema.isInt ? 'integer' : 'number' };
    for (const c of schema._def.checks) {
      if (c.kind === 'min') result.minimum = c.value;
      if (c.kind === 'max') result.maximum = c.value;
    }
    return result;
  }
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  if (schema instanceof z.ZodNull) return { type: 'null' };
  if (schema instanceof z.ZodEffects) return jsonSchema(schema.innerType());
  return {};
}
