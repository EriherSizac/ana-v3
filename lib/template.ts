type TemplateData = Record<string, string | undefined>

export function replaceTemplateVariables(template: string, data: TemplateData): string {
  let result = template

  // Reemplazar variables estándar con alias de compatibilidad
  const standardReplacements: Record<string, string> = {
    '{{phone}}': data.phone || '',
    '{{name}}': data.name || '',
    '{{credit}}': data.credit || '',
    '{{discount}}': data.discount || '',
    '{{first_name}}': data.first_name || '',
    '{{last_name}}': data.last_name || '',
    '{{total_balanc}}': data.total_balanc || data.total_balance || '',
    '{{product}}': data.product || '',
  }

  Object.entries(standardReplacements).forEach(([key, value]) => {
    result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value)
  })

  // Reemplazar cualquier otra variable o expresión matemática: {{columna*0.9}}
  result = result.replace(/\{\{([^}]+)\}\}/g, (match, varExpr) => {
    const trimmed = varExpr.trim()

    // Detectar si contiene operadores matemáticos
    const hasMathOp = /[+\-*\/()^%]/.test(trimmed)

    if (hasMathOp) {
      // Sustituir nombres de columnas por sus valores numéricos
      let expr = trimmed.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (colName: string) => {
        if (Object.prototype.hasOwnProperty.call(data, colName)) {
          const val = parseFloat(String(data[colName] ?? '').replace(/,/g, '.'))
          if (!isNaN(val)) return String(val)
        }
        return colName
      })

      try {
        // Solo evaluar si la expresión resultante es puramente numérica
        if (/^[0-9+\-*\/().\s%]+$/.test(expr)) {
          // eslint-disable-next-line no-new-func
          const evalResult = Function('"use strict"; return (' + expr + ')')() as number
          if (typeof evalResult === 'number' && isFinite(evalResult)) {
            return Number.isInteger(evalResult) ? String(evalResult) : evalResult.toFixed(2)
          }
        }
      } catch {
        // Si falla, continuar al fallback
      }
    }

    // Variable simple
    if (Object.prototype.hasOwnProperty.call(data, trimmed)) {
      return data[trimmed] || ''
    }

    return match
  })

  // Convertir \n literales a saltos de línea reales
  result = result.replace(/\\n/g, '\n')

  return result
}

export function getAvailableVariables(): string[] {
  return [
    '{{phone}}',
    '{{name}}',
    '{{credit}}',
    '{{discount}}',
    '{{first_name}}',
    '{{last_name}}',
    '{{total_balanc}}',
    '{{product}}',
  ]
}
