/** Parse API request JSON as an object; reject valid JSON primitives and arrays. */
export function parseRequestBody(raw) {
  let value;
  try {
    value = JSON.parse(raw || '{}');
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON'), { status: 400 });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Request body must be a JSON object'), { status: 400 });
  }
  return value;
}
