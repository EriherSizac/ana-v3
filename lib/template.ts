interface TemplateData {
  phone?: string
  name?: string
  credit?: string
  discount?: string
  first_name?: string
  last_name?: string
  total_balanc?: string
  product?: string
}

export function replaceTemplateVariables(template: string, data: TemplateData): string {
  let result = template

  // Replace all template variables
  const replacements: Record<string, string> = {
    '{{phone}}': data.phone || '',
    '{{name}}': data.name || '',
    '{{credit}}': data.credit || '',
    '{{discount}}': data.discount || '',
    '{{first_name}}': data.first_name || '',
    '{{last_name}}': data.last_name || '',
    '{{total_balanc}}': data.total_balanc || '',
    '{{product}}': data.product || '',
  }

  // Replace each variable in the template
  Object.entries(replacements).forEach(([key, value]) => {
    result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value)
  })

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
