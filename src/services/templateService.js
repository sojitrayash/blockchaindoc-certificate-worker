const logger = require('../utils/logger');

/**
 * Render HTML template by replacing placeholders with actual data
 * @param {string} htmlTemplate - HTML template with placeholders
 * @param {object} data - Data to inject into template
 * @returns {string} - Rendered HTML
 */
function renderTemplate(htmlTemplate, data) {
  let rendered = htmlTemplate;
  
  // Support for {{fieldName}} and ${fieldName} placeholder formats
  for (const [key, value] of Object.entries(data)) {
    const regex1 = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    const regex2 = new RegExp(`\\$\\{\\s*${key}\\s*\\}`, 'g');
    
    // Escape HTML to prevent injection
    const escapedValue = escapeHtml(String(value));
    
    rendered = rendered.replace(regex1, escapedValue);
    rendered = rendered.replace(regex2, escapedValue);
  }
  
  logger.debug('Template rendered successfully', { dataKeys: Object.keys(data) });
  return rendered;
}

/**
 * Validate that all required parameters are present in the data
 * @param {array} parameters - Array of parameter definitions
 * @param {object} data - Data object to validate
 * @throws {Error} - If required parameters are missing
 */
function validateParameters(parameters, data) {
  const missingParams = [];
  
  for (const param of parameters) {
    if (param.required && !(param.name in data)) {
      missingParams.push(param.name);
    }
  }
  
  if (missingParams.length > 0) {
    throw new Error(`Missing required parameters: ${missingParams.join(', ')}`);
  }
}

/**
 * Escape HTML special characters to prevent injection
 * @param {string} unsafe - Unsafe string
 * @returns {string} - Escaped string
 */
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = { renderTemplate, validateParameters };
