const keywords = require('../data/severityKeywords.json');

function classifySeverity(symptomsText) {
  const text = (symptomsText || '').toLowerCase();
  const matches = Object.entries(keywords).filter(([kw]) => text.includes(kw));
  if (matches.length === 0) return { level: 3, specialty: 'general' };
  matches.sort((a, b) => a[1].level - b[1].level);
  return matches[0][1];
}
module.exports = { classifySeverity };
