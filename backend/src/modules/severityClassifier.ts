import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const keywordsPath = path.join(__dirname, '..', '..', 'data', 'severityKeywords.json');
const keywords: Record<string, { level: number; specialty: 'general' | 'cardiac' | 'neuro' | 'obstetric' }> =
  JSON.parse(fs.readFileSync(keywordsPath, 'utf8'));

export interface ClassificationResult {
  level: number;
  specialty: 'general' | 'cardiac' | 'neuro' | 'obstetric';
  bedType: 'ER' | 'ICU' | 'General';
}

export function classifySeverity(symptomsText: string): ClassificationResult {
  const text = (symptomsText || '').toLowerCase();
  const matches = Object.entries(keywords).filter(([kw]) => text.includes(kw));

  if (matches.length === 0) {
    return { level: 3, specialty: 'general', bedType: 'ER' };
  }

  // Sort by lowest level number (highest urgency)
  matches.sort((a, b) => a[1].level - b[1].level);
  const bestMatch = matches[0][1];

  // Map severity level to bed type:
  // Level 1: ICU
  // Level 2, 3: ER
  // Level 4: General / ER
  let bedType: 'ER' | 'ICU' | 'General' = 'ER';
  if (bestMatch.level === 1) {
    bedType = 'ICU';
  } else if (bestMatch.level === 4) {
    bedType = 'General';
  }

  return {
    level: bestMatch.level,
    specialty: bestMatch.specialty,
    bedType
  };
}
