import { randomUUID } from 'node:crypto';

export const AI_PROMPT_VERSION = 'patient-education-2026-11-v1';

export function enforceLocalSafety(question: string, language: 'en' | 'hi') {
  const text = question.toLocaleLowerCase();
  const urgent = /\b(chest pain|heart attack|can't breathe|cannot breathe|difficulty breathing|shortness of breath|stroke|face droop|severe bleeding|unconscious|overdose|poisoning|suicid|self harm|seizure|fainting|severe allergic reaction)\b|सीने में दर्द|दिल का दौरा|सांस नहीं|साँस नहीं|सांस लेने में (कठिनाई|दिक्कत)|साँस लेने में (कठिनाई|दिक्कत)|बेहोश|अधिक खून|आत्महत्या|खुद को नुकसान|दौरा/.test(text);
  if (urgent) return { responseId: randomUUID(), answer: language === 'hi'
    ? 'आपके संदेश में ऐसी समस्या का उल्लेख हो सकता है जिसे तत्काल सहायता चाहिए। अभी अपने स्थानीय आपातकालीन नंबर पर कॉल करें या नज़दीकी आपातकालीन विभाग जाएँ। यदि संभव हो तो किसी भरोसेमंद व्यक्ति को अपने साथ रखें। मैं यहाँ से आपात स्थिति का आकलन नहीं कर सकता।'
    : 'Your message may describe a situation that needs immediate help. Call your local emergency number now or go to the nearest emergency department. If possible, have someone you trust stay with you. I cannot assess emergencies here.', kind: 'urgent', sources: [], promptVersion: AI_PROMPT_VERSION };
  const prohibited = /\b(diagnos(e|is|e me)|what disease|what condition do i have|prescribe|should i start|stop taking|change my dose|increase my dose|decrease my dose|dosage|dose adjustment)\b|निदान|कौन सी बीमारी|दवा शुरू|दवा बंद|खुराक बदल|डोज़ बदल/.test(text);
  if (prohibited) return { responseId: randomUUID(), answer: language === 'hi'
    ? 'मैं बीमारी का निदान, दवा लिखने, या दवा/खुराक बदलने की सलाह नहीं दे सकता। अपने प्रश्न और रिपोर्ट किसी योग्य चिकित्सक या फार्मासिस्ट से साझा करें।'
    : 'I cannot diagnose a condition, prescribe medicine, or advise changing a medicine or dose. Please discuss your question and reports with a qualified clinician or pharmacist.', kind: 'safety-refusal', sources: [], promptVersion: AI_PROMPT_VERSION };
  return null;
}
