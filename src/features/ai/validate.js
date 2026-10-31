// A small JSON Schema checker for tool inputs coming back from an AI (untrusted data). It covers
// what tool schemas use: type, enum, const, required, properties, additionalProperties, items,
// min/max, minLength/maxLength, minItems/maxItems, anyOf/oneOf. Returns a list of problems.
const MAX_ERRORS = 8;

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function typeOk(v, t) {
  const actual = typeOf(v);
  if (t === "number") return actual === "number" || actual === "integer";
  return actual === t;
}

function check(schema, v, path, errors) {
  if (!schema || typeof schema !== "object" || errors.length >= MAX_ERRORS) return;
  const at = path || "input";
  const alts = schema.anyOf || schema.oneOf;
  if (Array.isArray(alts) && alts.length) {
    const ok = alts.some((s) => { const e = []; check(s, v, path, e); return e.length === 0; });
    if (!ok) errors.push(`${at} doesn't match any allowed shape`);
    return;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeOk(v, t))) {
      errors.push(`${at} should be ${types.join(" or ")}, not ${typeOf(v)}`);
      return;
    }
  }
  if ("const" in schema && JSON.stringify(v) !== JSON.stringify(schema.const)) errors.push(`${at} should be ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) {
    errors.push(`${at} should be one of ${schema.enum.slice(0, 12).map((e) => JSON.stringify(e)).join(", ")}`);
  }
  if (typeof v === "number") {
    if (typeof schema.minimum === "number" && v < schema.minimum) errors.push(`${at} should be at least ${schema.minimum}`);
    if (typeof schema.maximum === "number" && v > schema.maximum) errors.push(`${at} should be at most ${schema.maximum}`);
    if (!Number.isFinite(v)) errors.push(`${at} should be a real number`);
  }
  if (typeof v === "string") {
    if (typeof schema.minLength === "number" && v.length < schema.minLength) errors.push(`${at} is too short`);
    if (typeof schema.maxLength === "number" && v.length > schema.maxLength) errors.push(`${at} is too long (max ${schema.maxLength})`);
  }
  if (Array.isArray(v)) {
    if (typeof schema.minItems === "number" && v.length < schema.minItems) errors.push(`${at} needs at least ${schema.minItems} items`);
    if (typeof schema.maxItems === "number" && v.length > schema.maxItems) errors.push(`${at} has too many items (max ${schema.maxItems})`);
    if (schema.items && typeof schema.items === "object") v.forEach((item, i) => check(schema.items, item, `${at}[${i}]`, errors));
  }
  if (typeOf(v) === "object") {
    const props = schema.properties || {};
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (!(key in v)) errors.push(`${at}.${key} is missing`);
    }
    for (const [key, val] of Object.entries(v)) {
      if (props[key]) check(props[key], val, `${at}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${at}.${key} isn't allowed`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") check(schema.additionalProperties, val, `${at}.${key}`, errors);
    }
  }
}

/** @returns {string[]} problems, empty when the input is valid. */
export function validateInput(schema, input) {
  const errors = [];
  check(schema || { type: "object" }, input, "", errors);
  return errors;
}
