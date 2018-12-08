function parseChanges (dirty, fields, data) {
  const simple = {}
  const complex = {}
  const relations = {}
  for (const key of dirty) {
    const field = fields[key]
    if (key === 'id') continue
    if (field.schemaType === 'relation') {
      relations[key] = data[key]
    } else if (field.schemaType === 'array' || field.schemaType === 'object') {
      complex[key] = data[key]
    } else {
      simple[key] = data[key]
    }
  }
  return { simple, complex, relations }
}

module.exports = parseChanges
