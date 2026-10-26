// Sprache kommt aus <html lang>: "/" ist Deutsch, "/en/" Englisch.
import { T as de } from './strings.de.js';
import { T as en } from './strings.en.js';

export const LANG = globalThis.document?.documentElement.lang === 'en' ? 'en' : 'de';
export const T = LANG === 'en' ? en : de;
